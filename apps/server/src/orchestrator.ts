import {
  resolveExecutor,
  registerExecutor,
  resetExecutorRegistry,
  listExecutors,
  type ExecutorContext,
} from "@openx/executor-core";
import { acpExecutor, detectAcpRuntime } from "@openx/executor-acp";
import { createConnectExecutor } from "@openx/executor-connect";
import { pickExecutorWithPi, piExecutor } from "@openx/executor-pi";
import { mockExecutor } from "@openx/executor-mock";
import {
  ACP_RUNTIMES,
  EXECUTOR_AUTO,
  buildClaudeAcpEnv,
  isAcpCliConfigTarget,
  isConnectExecutorId,
  isConnectAnyExecutorId,
  parseModelRef,
  resolveProviderConfig,
  type AcpRuntimeId,
  type GoalDeliverable,
  type RunDeltaEvent,
} from "@openx/shared";
import { canTransition } from "@openx/shared";
import { resolveMergedLlmContext } from "./llm-context-resolve.js";
import { notifyEventWebhook } from "./event-webhook.js";
import {
  appendLog,
  areDependenciesMet,
  getConversationById,
  getGoalById,
  getWorkspaceDirForConversation,
  insertDispatchReceipt,
  listCrewExchanges,
  listExecutionSummaries,
  listReviewRounds,
  listLogs,
  listRunnableDraftGoals,
  listGoals,
  updateGoal,
  updateGoalCrewBinding,
} from "./db.js";
import { handleCrewQuestion, handleCrewTurnReview, isCrewEscalation } from "./foreman-loop.js";
import {
  persistForemanDirective,
  persistUserCrewDirective,
  persistCrewQuestion,
  persistForemanEscalation,
  persistForemanReview,
} from "./crew-persist.js";
import type { CrewDirective, CrewQuestion, ForemanTurnReviewInput } from "@openx/shared";
import {
  buildResumeTranscriptBlock,
  ensureCrewRequestId,
  formatCrewForemanReplyForPrompt,
  foremanTurnDecisionToDirective,
  shouldElevateAskWriteOnResume,
} from "@openx/shared";
import {
  getConnectionByExecutorId,
  listConnections,
  markGoalCancelledForConnect,
  clearGoalCancelledForConnect,
} from "./connect-store.js";
import { narrateGoalChange } from "./narration.js";
import { resolveAcpCliCredentialsFromRef } from "./acp-cli-config.js";
import { bootstrapConnectProfile } from "./cli-bootstrap.js";
import { getServerBaseUrl } from "./server-base-url.js";
import { shouldRunPiInWorker, runPiInWorker, cancelPiChild, hasParkedPiChild, resumePiChild } from "./pi-isolated-run.js";
import { loadSettings } from "./settings-store.js";
import { resolveWorkspaceRoot } from "./workspace-path.js";
import { loadKnowledgeContextForExecutor } from "./knowledge-store.js";
import { resolveSystemWorkspaceRoot } from "./system-workspace-path.js";
import { syncWorkspaceMcpJson } from "./workspace-mcp-json.js";
import { OPENX_MCP_ID } from "@openx/shared";
import {
  isClearRuleWinner,
  recommendExecutorForGoal,
} from "./executor-recommend-service.js";
import { resolveDispatchAgentRole, resolveDispatchMcpServers } from "./dispatch-context.js";
import { resolveExecutorSkills } from "./skills-resolve.js";
import {
  emitGoalRunEvent,
  endGoalRun,
  flushMergeBuffer,
  isRunActive,
  startGoalRun,
} from "./run-service.js";
import { broadcast } from "./sse.js";
import {
  claimGoalForDispatch,
  claimPausedGoalForResume,
  markGoalComplete,
  markGoalFailed,
  parkGoalAsPaused,
  updateGoalProgress,
} from "./goal-lifecycle.js";

let registered = false;
const dispatchLocks = new Set<string>();

/** 测试用：重置执行器注册，使 OPENX_MOCK_PI 等环境变量生效 */
export function resetOrchestrator(): void {
  registered = false;
  resetExecutorRegistry();
  dispatchLocks.clear();
}

export function ensureExecutors() {
  if (!registered) {
    if (process.env.OPENX_MOCK_PI === "1") {
      registerExecutor({ ...mockExecutor, id: "pi", displayName: "Pi（Mock 测试）" });
    } else {
      registerExecutor(piExecutor);
    }
    registerExecutor(acpExecutor);
    registerExecutor(
      createConnectExecutor({
        getConnection: (executorId) => getConnectionByExecutorId(executorId),
        listConnections,
        listCliProfiles: () => {
          const settings = loadSettings();
          return (settings.cliProfiles ?? []).map((p) => ({
            executorId: p.executorId,
            displayName: p.displayName,
            kind: p.kind,
          }));
        },
      }),
    );
    registered = true;
  }
}

function isGoalCrewBindingWritable(goalId: string): boolean {
  const g = getGoalById(goalId);
  return g?.status === "running";
}

function syncCrewBinding(
  goalId: string,
  patch: Parameters<typeof updateGoalCrewBinding>[1],
): void {
  if (!isGoalCrewBindingWritable(goalId)) return;
  updateGoalCrewBinding(goalId, patch);
  const updated = getGoalById(goalId);
  if (updated) broadcast({ type: "goal.updated", goal: updated });
}

function buildCallbacks(goalId: string) {
  return {
    onProgress: async (progress: number, message?: string) => {
      const g = getGoalById(goalId);
      if (!g || g.status !== "running") return;
      updateGoalProgress(goalId, progress, message);
    },
    onLog: async (level: "info" | "warn" | "error" | "debug", message: string) => {
      const log = appendLog(goalId, level, message);
      broadcast({ type: "log.append", goalId, ...log });
    },
    onRunEvent: async (event: RunDeltaEvent) => {
      emitGoalRunEvent(goalId, event);
    },
    onComplete: async (resultSummary: string, deliverables?: GoalDeliverable[]) => {
      const g = getGoalById(goalId);
      if (!g || g.status !== "running") return;
      clearGoalCancelledForConnect(goalId);
      const result = markGoalComplete(goalId, resultSummary, deliverables);
      if (!result.ok) {
        appendLog(
          goalId,
          "warn",
          `执行器交差被拒绝：${result.error}`,
        );
        return;
      }
      // 动态 import 避免 orchestrator ↔ goal-actions 循环依赖
      const { maybeAutoReview } = await import("./auto-review.js");
      void maybeAutoReview(goalId);
    },
    onFail: async (errorMessage: string) => {
      const g = getGoalById(goalId);
      if (!g || g.status !== "running") return;
      clearGoalCancelledForConnect(goalId);
      updateGoalCrewBinding(goalId, { crewStatus: null });
      markGoalFailed(goalId, errorMessage);

      void notifyEventWebhook("goal_failed", { goalId, errorMessage });
    },
    onParkAwaitingUser: async (checkpointSummary: string) => {
      const g = getGoalById(goalId);
      if (!g || g.status !== "running") return;
      parkGoalAsPaused(goalId, checkpointSummary);
    },
    onCrewSession: async (crewSessionId: string) => {
      const g = getGoalById(goalId);
      if (!g || g.status !== "running") return;
      updateGoalCrewBinding(goalId, {
        foremanThreadId: g.foremanThreadId ?? g.conversationId,
        crewSessionId,
        crewStatus: "idle",
      });
      const updated = getGoalById(goalId);
      if (updated) broadcast({ type: "goal.updated", goal: updated });
    },
    onCrewQuestion: async (question: CrewQuestion): Promise<CrewDirective> => {
      const g = getGoalById(goalId);
      if (!g || g.status !== "running") {
        return {
          kind: "directive",
          message: "工头暂不可用，请按验收标准自行选择合理方案继续。",
          source: "foreman_rule",
          ...(question.requestId ? { replyTo: question.requestId } : {}),
        };
      }
      const correlatedQuestion = ensureCrewRequestId(question);
      syncCrewBinding(goalId, { crewStatus: "awaiting_foreman" });
      persistCrewQuestion(goalId, correlatedQuestion);
      const outcome = await handleCrewQuestion({
        goal: g,
        question: correlatedQuestion,
      });
      if (!isGoalCrewBindingWritable(goalId)) {
        return {
          kind: "directive",
          message: "任务已结束，施工队将按最后已知指令收尾。",
          source: "foreman_rule",
          ...(correlatedQuestion.requestId
            ? { replyTo: correlatedQuestion.requestId }
            : {}),
        };
      }
      if (isCrewEscalation(outcome)) {
        syncCrewBinding(goalId, { crewStatus: "awaiting_user" });
        persistForemanEscalation(goalId, outcome);
        appendLog(
          goalId,
          "warn",
          `工头上报开发商：${outcome.prompt.slice(0, 200)}`,
        );
        return {
          kind: "directive",
          message: outcome.reason
            ? `工头已提请开发商确认：${outcome.reason}。请暂停施工，等待开发商回复后的【工头】指令。`
            : "工头已提请开发商确认。请暂停施工，等待开发商回复后的【工头】指令。",
          source: "foreman_rule",
          pauseUntilUser: true,
          ...(outcome.replyTo ? { replyTo: outcome.replyTo } : {}),
          ...(correlatedQuestion.requestId && !outcome.replyTo
            ? { replyTo: correlatedQuestion.requestId }
            : {}),
        };
      }
      syncCrewBinding(goalId, { crewStatus: "idle" });
      persistForemanDirective(goalId, outcome);
      appendLog(goalId, "info", `工头指令 › ${outcome.message.slice(0, 240)}`);
      return outcome;
    },
    onCrewTurnReview: async (turn: ForemanTurnReviewInput) => {
      const g = getGoalById(goalId);
      if (!g || g.status !== "running") {
        return {
          action: "continue" as const,
          message: "继续推进，按验收标准完成可验证产出。",
          source: "foreman_rule" as const,
        };
      }
      syncCrewBinding(goalId, { crewStatus: "awaiting_foreman" });
      const decision = await handleCrewTurnReview({ goal: g, turn });
      if (!isGoalCrewBindingWritable(goalId)) {
        return decision;
      }

      switch (decision.action) {
        case "continue":
          syncCrewBinding(goalId, { crewStatus: "idle" });
          persistForemanDirective(goalId, foremanTurnDecisionToDirective(decision));
          break;
        case "ask_user":
          syncCrewBinding(goalId, { crewStatus: "awaiting_user" });
          persistForemanReview(
            goalId,
            `提请开发商：${decision.message}`,
            decision,
          );
          break;
        case "submit_for_review":
          syncCrewBinding(goalId, { crewStatus: "idle" });
          persistForemanReview(goalId, `交差：${decision.message}`, decision);
          break;
        case "fail":
          syncCrewBinding(goalId, { crewStatus: null });
          persistForemanReview(goalId, `失败：${decision.message}`, decision);
          break;
      }

      appendLog(
        goalId,
        decision.action === "fail" ? "warn" : "info",
        `工头轮次 › ${decision.action}: ${decision.message.slice(0, 240)}`,
      );
      return decision;
    },
  };
}

function resolveWorkspaceForGoal(goal: { conversationId: string }): string {
  const settings = loadSettings();
  const projectDir = getWorkspaceDirForConversation(goal.conversationId);
  return resolveWorkspaceRoot(projectDir ?? resolveSystemWorkspaceRoot(settings));
}

function buildExecutorContext(goalId: string, isRework?: boolean): ExecutorContext {
  const goal = getGoalById(goalId);
  if (!goal) throw new Error("Goal not found");
  const settings = loadSettings();
  const priorLogs = listLogs(goalId, 30).map((l) => ({
    level: l.level,
    message: l.message,
  }));
  const priorSummaries = listExecutionSummaries(goalId, 10);
  const priorReviewRounds = listReviewRounds(goalId, 8);
  const crewExchanges = listCrewExchanges(goalId, 24).map((e) => ({
    direction: e.direction,
    summary: e.summary,
  }));
  const resumeTranscript = buildResumeTranscriptBlock({
    crewExchanges,
    priorSummaries,
    priorLogs,
  });
  const workspaceRoot = resolveWorkspaceForGoal(goal);
  const conversation = getConversationById(goal.conversationId);
  const projectKnowledge =
    conversation != null
      ? loadKnowledgeContextForExecutor(workspaceRoot, conversation.projectId)
      : undefined;
  const dispatch = goal.dispatchContext;
  // ACP 默认无人值守：未显式指定权限时应用 settings
  let effectiveDispatch = dispatch;
  if (
    !dispatch?.permissionMode &&
    goal.executorId.startsWith("acp:") &&
    settings.executors.acp?.defaultSkipPermissions
  ) {
    effectiveDispatch = { ...dispatch, permissionMode: "unattended" };
  }
  const { hints: enabledSkills } = resolveExecutorSkills(
    goal.executorId,
    settings,
    effectiveDispatch?.skillIds,
  );
  const mcpServers = resolveDispatchMcpServers(settings, effectiveDispatch?.mcpIds);
  const agentRole = resolveDispatchAgentRole(settings, effectiveDispatch?.agentId);
  let spawnEnv: Record<string, string> | undefined;
  if (isAcpCliConfigTarget(goal.executorId)) {
    const modelRef = settings.acpCli?.[goal.executorId];
    if (modelRef) {
      const creds = resolveAcpCliCredentialsFromRef(
        settings,
        modelRef,
        goal.executorId as "acp:codex" | "acp:claude",
      );
      if (creds) {
        if (goal.executorId === "acp:claude") {
          const parsed = parseModelRef(modelRef);
          const provider = parsed ? resolveProviderConfig(settings, parsed.slug) : null;
          spawnEnv = buildClaudeAcpEnv(creds, {
            providerTemplate: provider?.source?.template,
          });
        } else {
          spawnEnv = {
            OPENAI_API_KEY: creds.apiKey,
            OPENAI_BASE_URL: creds.baseUrl,
            OPENAI_MODEL: creds.model,
          };
        }
      }
    }
  }
  return {
    goal:
      effectiveDispatch && effectiveDispatch !== dispatch
        ? { ...goal, dispatchContext: effectiveDispatch }
        : goal,
    workspaceRoot,
    settings: {
      pi: settings.executors.pi,
      model: settings.model,
      providers: settings.providers,
    },
    priorLogs,
    priorSummaries,
    priorReviewRounds,
    isRework,
    enabledSkills,
    mcpServers,
    agentRole,
    llmContext: resolveMergedLlmContext({ goalId }),
    projectKnowledge,
    spawnEnv,
    resumeTranscript,
    sandboxConfig: (() => {
      const sand =
        goal.executorId === "pi"
          ? settings.executors.pi?.sandbox
          : settings.executors.acp?.sandbox;
      if (!sand?.enabled) return undefined;
      if (sand.allowedPaths?.length) {
        appendLog(
          goalId,
          "warn",
          `沙箱已配置但尚未执行隔离（type=${sand.type}，allowedPaths=${sand.allowedPaths.length}）；当前仍在宿主机 cwd 执行`,
        );
      } else {
        appendLog(
          goalId,
          "warn",
          `沙箱已配置但尚未执行隔离（type=${sand.type}）；当前仍在宿主机 cwd 执行`,
        );
      }
      return {
        type: sand.type,
        image: sand.image,
      };
    })(),
    callbacks: buildCallbacks(goalId),
  };
}

/** 依赖已满足的 draft 子目标自动启动（approve 后触发；受 autoStartDependents 控制） */
export function tryDispatchDependents(completedGoalId: string): void {
  const settings = loadSettings();
  if (!settings.autoStartDependents) {
    appendLog(
      completedGoalId,
      "info",
      "自动策略：依赖子任务未启动（autoStartDependents=false）",
    );
    return;
  }

  const candidates = listRunnableDraftGoals().filter((g) =>
    g.dependsOn.includes(completedGoalId),
  );

  for (const child of candidates) {
    if (!canTransition(child.status, "running")) continue;
    const claimed = claimGoalForDispatch(child.id, ["draft"]);
    if (!claimed) continue;
    broadcast({ type: "goal.updated", goal: claimed });
    narrateGoalChange(claimed, "start");
    appendLog(
      claimed.id,
      "info",
      `自动策略：依赖 ${completedGoalId} 已完成，自动启动（autoStartDependents）`,
    );
    void dispatchGoal(claimed.id);
  }
}

export async function steerReworkGoal(goalId: string): Promise<boolean> {
  ensureExecutors();
  const goal = getGoalById(goalId);
  if (!goal) return false;
  if (goal.executorId === EXECUTOR_AUTO) return false;

  const adapter = resolveExecutor(goal.executorId);
  if (!adapter?.steerRework) return false;

  try {
    if (isRunActive(goalId)) {
      appendLog(goalId, "warn", "返工 steer 跳过：已有活跃 run");
      return false;
    }
    flushMergeBuffer(goalId);
    startGoalRun(goalId, goal.executorId);
    const ctx = buildExecutorContext(goalId, true);
    if (goal.executorId === "pi" && hasParkedPiChild(goalId)) {
      return await resumePiChild(ctx);
    }
    return await adapter.steerRework(ctx);
  } catch (err) {
    endGoalRun(goalId, "failed", err instanceof Error ? err.message : String(err));
    appendLog(
      goalId,
      "error",
      `返工 steer 失败：${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

/** 显式续跑：将开发商决策注入已暂停（paused）的施工队 session */
export async function resumeCrewAfterUserDecision(
  goalId: string,
  userMessage: string,
  opts?: { alreadyClaimedRunning?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  ensureExecutors();
  let goal = getGoalById(goalId);
  if (!goal) return { ok: false, error: "目标不存在" };

  // 兼容迁移前：running + awaiting_user → 先升为正式 paused
  if (goal.status === "running" && goal.crewStatus === "awaiting_user") {
    const parked = parkGoalAsPaused(goalId);
    if (!parked.ok) return { ok: false, error: parked.error };
    goal = parked.goal;
  }

  if (goal.status !== "paused" && !opts?.alreadyClaimedRunning) {
    return { ok: false, error: "目标未处于暂停等待决策" };
  }
  if (goal.status === "paused" && !opts?.alreadyClaimedRunning) {
    const claimed = claimPausedGoalForResume(goalId);
    if (!claimed) return { ok: false, error: "无法从暂停态恢复" };
    goal = claimed;
  }
  if (goal.status !== "running") {
    return { ok: false, error: "目标未处于执行中" };
  }
  if (isRunActive(goalId)) {
    return { ok: false, error: "施工队仍在运行" };
  }

  const trimmed = userMessage.trim();
  if (!trimmed) return { ok: false, error: "回复不能为空" };

  if (goal.dispatchContext?.permissionMode === "ask_write") {
    if (shouldElevateAskWriteOnResume(trimmed)) {
      goal.dispatchContext = {
        ...goal.dispatchContext,
        permissionMode: "full",
      };
      goal.updatedAt = new Date().toISOString();
      try {
        const elevated = updateGoal(goal);
        appendLog(goalId, "info", "开发商已确认写入，派单权限提升为完全授权");
        broadcast({ type: "goal.updated", goal: elevated });
      } catch {
        appendLog(goalId, "warn", "派单权限提升冲突，将使用当前 goal 状态续跑");
      }
    } else {
      appendLog(goalId, "info", "开发商拒绝写入，保持写前确认（只读工具）");
    }
  }

  const adapter = resolveExecutor(goal.executorId);
  if (!adapter?.steerRework) {
    parkGoalAsPaused(goalId, "当前执行器不支持施工队续跑");
    return { ok: false, error: "当前执行器不支持施工队续跑" };
  }

  const directive: CrewDirective = {
    kind: "directive",
    message: trimmed,
    source: "foreman_user",
  };
  persistUserCrewDirective(goalId, directive);
  updateGoalCrewBinding(goalId, { crewStatus: "idle" });
  const updatedAfterDirective = getGoalById(goalId);
  if (updatedAfterDirective) {
    broadcast({ type: "goal.updated", goal: updatedAfterDirective });
  }

  flushMergeBuffer(goalId);
  startGoalRun(goalId, goal.executorId);
  const ctx = buildExecutorContext(goalId, false);
  ctx.crewContinuationPrompt = formatCrewForemanReplyForPrompt({
    ...directive,
    message: `【开发商】${trimmed}`,
  });

  try {
    if (goal.executorId === "pi" && hasParkedPiChild(goalId)) {
      const ok = await resumePiChild(ctx);
      if (!ok) {
        endGoalRun(goalId, "failed", "施工队续跑失败：worker session 不可用");
        parkGoalAsPaused(goalId, "施工队 session 不可用");
        return { ok: false, error: "施工队 session 不可用，请重新派发" };
      }
      return { ok: true };
    }
    const ok = await adapter.steerRework(ctx);
    if (!ok) {
      endGoalRun(goalId, "failed", "施工队续跑失败：session 不可用");
      parkGoalAsPaused(goalId, "施工队 session 不可用");
      return { ok: false, error: "施工队 session 不可用，请重新派发" };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    endGoalRun(goalId, "failed", msg);
    parkGoalAsPaused(goalId, msg);
    return { ok: false, error: msg };
  }
}

/** 查找本对话中正式暂停（paused）的任务；无 preferred 时不默认猜最后一个 */
export function findPausedGoal(
  conversationId: string,
  preferredGoalId?: string,
): { id: string } | undefined {
  if (preferredGoalId) {
    const g = getGoalById(preferredGoalId);
    if (
      g &&
      g.conversationId === conversationId &&
      (g.status === "paused" ||
        (g.status === "running" && g.crewStatus === "awaiting_user"))
    ) {
      return { id: g.id };
    }
    return undefined;
  }
  const paused = listGoals({ conversationId, status: "paused" });
  if (paused.length === 1) return { id: paused[0]!.id };
  const legacy = listGoals({ conversationId, status: "running" }).filter(
    (g) => g.crewStatus === "awaiting_user",
  );
  if (legacy.length === 1) return { id: legacy[0]!.id };
  return undefined;
}

/** @deprecated 使用 findPausedGoal；保留别名以免外部引用断裂 */
export function findAwaitingUserGoal(
  conversationId: string,
  preferredGoalId?: string,
): { id: string } | undefined {
  return findPausedGoal(conversationId, preferredGoalId);
}

async function materializeAutoExecutor(goalId: string): Promise<void> {
  const goal = getGoalById(goalId);
  if (!goal || goal.executorId !== EXECUTOR_AUTO) return;

  const settings = loadSettings();
  const detected = await detectExecutors();

  const recommendation = await recommendExecutorForGoal(
    {
      title: goal.title,
      acceptance: goal.acceptance,
      executionPrompt: goal.executionPrompt,
    },
    detected,
  );

  let chosen: string;
  if (recommendation && isClearRuleWinner(recommendation)) {
    chosen = recommendation.executorId;
    appendLog(goalId, "info", `规则推荐执行器：${chosen}（${recommendation.reason}）`);
  } else {
    chosen = await pickExecutorWithPi({
      title: goal.title,
      acceptance: goal.acceptance,
      executionPrompt: goal.executionPrompt,
      workspaceRoot: resolveWorkspaceForGoal(goal),
      candidates: detected
        .filter((e) => e.id !== EXECUTOR_AUTO)
        .map((e) => ({
          id: e.id,
          label: e.displayName,
          hint: e.hint,
          available: e.available,
        })),
      settings: {
        pi: settings.executors.pi,
        model: settings.model,
        providers: settings.providers,
      },
      llmContextSettings: resolveMergedLlmContext({ goalId }),
    });
    appendLog(goalId, "info", `Pi 自动选择执行器：${chosen}`);
  }

  goal.executorId = chosen;
  goal.updatedAt = new Date().toISOString();
  const saved = updateGoal(goal);
  broadcast({ type: "goal.updated", goal: saved });
}

const BOOTSTRAP_WAIT_MS = Number(process.env.OPENX_BOOTSTRAP_WAIT_MS ?? 45_000);
const BOOTSTRAP_POLL_MS = 500;

/** Connect 执行器未在线时尝试自动自举并等待注册（缺陷 A 修复） */
async function ensureConnectExecutorOnline(
  goalId: string,
  executorId: string,
): Promise<boolean> {
  if (isConnectAnyExecutorId(executorId)) return true;
  if (!isConnectExecutorId(executorId)) return true;
  if (getConnectionByExecutorId(executorId)) return true;

  const settings = loadSettings();
  const profile = settings.cliProfiles.find(
    (p) => p.executorId === executorId && p.kind === "connect",
  );
  if (!profile) {
    appendLog(
      goalId,
      "warn",
      `Connect 执行器 ${executorId} 未在 settings.cliProfiles 中配置，无法自动自举`,
    );
    return false;
  }

  appendLog(goalId, "info", `执行器 ${executorId} 未在线，正在自动自举…`);
  try {
    bootstrapConnectProfile(profile, getServerBaseUrl());
  } catch (err) {
    appendLog(
      goalId,
      "warn",
      `自举失败：${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }

  const deadline = Date.now() + BOOTSTRAP_WAIT_MS;
  while (Date.now() < deadline) {
    if (getConnectionByExecutorId(executorId)) {
      appendLog(goalId, "info", `执行器 ${executorId} 自举成功，已上线`);
      return true;
    }
    await new Promise((r) => setTimeout(r, BOOTSTRAP_POLL_MS));
  }
  appendLog(
    goalId,
    "warn",
    `自举超时：${executorId} 未在 ${BOOTSTRAP_WAIT_MS / 1000}s 内注册上线`,
  );
  return false;
}

export async function dispatchGoal(goalId: string): Promise<void> {
  if (dispatchLocks.has(goalId) || isRunActive(goalId)) {
    appendLog(goalId, "warn", "派发跳过：该目标已有活跃执行");
    return;
  }

  dispatchLocks.add(goalId);
  try {
    ensureExecutors();
    const goal = getGoalById(goalId);
    if (!goal) throw new Error("Goal not found");

    if (!areDependenciesMet(goal)) {
      appendLog(
        goalId,
        "info",
        `等待依赖完成：${goal.dependsOn.join(", ")}`,
      );
      return;
    }

    if (goal.executorId === EXECUTOR_AUTO) {
      await materializeAutoExecutor(goalId);
    }

    const resolved = getGoalById(goalId);
    if (!resolved) throw new Error("Goal not found");

    if (resolved.status === "paused") {
      appendLog(
        goalId,
        "warn",
        "派发跳过：任务已暂停等待开发商决策；请显式续跑（回复并继续或 /resume）",
      );
      return;
    }

    if (resolved.status !== "running") {
      appendLog(goalId, "warn", `派发跳过：目标状态为 ${resolved.status}`);
      return;
    }

    if (resolved.crewStatus === "awaiting_user") {
      appendLog(
        goalId,
        "warn",
        "派发跳过：工头已暂停施工队，等待开发商决策；请显式续跑（回复并继续或 /resume）",
      );
      return;
    }

    const connectReady = await ensureConnectExecutorOnline(
      goalId,
      resolved.executorId,
    );
    if (
      !connectReady &&
      isConnectExecutorId(resolved.executorId) &&
      !isConnectAnyExecutorId(resolved.executorId)
    ) {
      const failMsg = `Connect 执行器 ${resolved.executorId} 未上线（未配置 profile、自举失败或 ${BOOTSTRAP_WAIT_MS / 1000}s 内超时）`;
      appendLog(goalId, "error", failMsg);
      markGoalFailed(goalId, failMsg);
      endGoalRun(goalId, "failed", failMsg);
      return;
    }

    const adapter = resolveExecutor(resolved.executorId);
    if (!adapter) {
      throw new Error(`Unknown executor: ${resolved.executorId}`);
    }

    clearGoalCancelledForConnect(goalId);
    const settings = loadSettings();
    const workspaceRoot = resolveWorkspaceForGoal(resolved);
    if (resolved.executorId.startsWith("acp:")) {
      const synced = syncWorkspaceMcpJson(
        workspaceRoot,
        settings.mcpServers?.find((s) => s.id === OPENX_MCP_ID),
      );
      if (synced.written) {
        appendLog(goalId, "info", `已同步工作区 MCP 配置：${synced.path}`);
      }
    }
    const ctx = buildExecutorContext(goalId, resolved.effectStatus === "rework");
    const runId = startGoalRun(goalId, resolved.executorId);
    const receipt = insertDispatchReceipt({
      goalId,
      runId,
      executorId: resolved.executorId,
      dispatchContext: resolved.dispatchContext,
      workspaceRoot: ctx.workspaceRoot,
    });
    appendLog(
      goalId,
      "info",
      `派单凭证 receipt=${receipt.receiptId} run=${runId} executor=${resolved.executorId}`,
    );
    const goalWithReceipt = getGoalById(goalId);
    if (goalWithReceipt) {
      broadcast({
        type: "goal.updated",
        goal: goalWithReceipt,
        receiptId: receipt.receiptId,
        activeRunId: runId,
      });
    }

    const runExec = () => {
      if (resolved.executorId === "pi" && shouldRunPiInWorker()) {
        return runPiInWorker(ctx);
      }
      return adapter.run(ctx);
    };

    void runExec().catch(async (err: Error) => {
      endGoalRun(goalId, "failed", err.message);
      const g = getGoalById(goalId);
      if (!g || g.status !== "running") return;
      markGoalFailed(goalId, err.message);
    });
  } finally {
    dispatchLocks.delete(goalId);
  }
}

export function cancelRunning(goalId: string): void {
  ensureExecutors();
  const goal = getGoalById(goalId);
  if (!goal) return;
  endGoalRun(goalId, "cancelled");
  if (isConnectExecutorId(goal.executorId)) {
    markGoalCancelledForConnect(goalId);
  }
  const adapter = resolveExecutor(goal.executorId);
  if (goal.executorId === "pi" && shouldRunPiInWorker()) {
    cancelPiChild(goalId);
  } else {
    adapter?.cancel?.(goalId);
  }
}

const EXECUTORS_CACHE_MS = 8_000;

type ExecutorDetectResult = {
  id: string;
  displayName: string;
  available: boolean;
  hint?: string;
  bootstrappable?: boolean;
};

let executorsCache: { at: number; results: ExecutorDetectResult[] } | null = null;

export function invalidateExecutorDetectCache(): void {
  executorsCache = null;
}

export async function detectExecutors() {
  ensureExecutors();
  const now = Date.now();
  if (executorsCache && now - executorsCache.at < EXECUTORS_CACHE_MS) {
    return executorsCache.results;
  }

  const settings = loadSettings();
  const detectSettings = {
    pi: settings.executors.pi,
    model: settings.model,
    providers: settings.providers,
  };
  const results: ExecutorDetectResult[] = [
    {
      id: EXECUTOR_AUTO,
      displayName: "自动（Pi 选择）",
      available: true,
      hint: "启动时由 Pi 根据任务与在线执行器自动派单",
    },
  ];

  for (const adapter of listExecutors()) {
    if (adapter.detectEntries) {
      results.push(...(await adapter.detectEntries(detectSettings)));
      continue;
    }
    const det = await adapter.detect(detectSettings);
    results.push({ id: adapter.id, displayName: adapter.displayName, ...det });
  }

  if (!results.some((e) => e.id.startsWith("acp:"))) {
    for (const runtimeId of Object.keys(ACP_RUNTIMES) as AcpRuntimeId[]) {
      const cfg = ACP_RUNTIMES[runtimeId];
      const det = await detectAcpRuntime(runtimeId);
      results.push({ id: runtimeId, displayName: cfg.label, ...det });
    }
  }

  const filtered = results.filter(
    (e) => e.id !== "acp" || !results.some((x) => x.id.startsWith("acp:")),
  );
  executorsCache = { at: Date.now(), results: filtered };
  return filtered;
}
