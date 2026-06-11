import {
  resolveExecutor,
  registerExecutor,
  resetExecutorRegistry,
  listExecutors,
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
  type RunDeltaEvent,
} from "@openx/shared";
import { canTransition } from "@openx/shared";
import {
  appendLog,
  areDependenciesMet,
  getGoalById,
  getWorkspaceDirForConversation,
  listExecutionSummaries,
  listReviewRounds,
  listLogs,
  listRunnableDraftGoals,
  updateGoal,
} from "./db.js";
import {
  getConnectionByExecutorId,
  listConnections,
  markGoalCancelledForConnect,
  clearGoalCancelledForConnect,
} from "./connect-store.js";
import { narrateGoalChange } from "./narration.js";
import { resolveAcpCliCredentialsFromRef } from "./acp-cli-config.js";
import { bootstrapConnectProfile } from "./cli-bootstrap.js";
import { shouldRunPiInWorker, runPiInWorker, cancelPiChild } from "./pi-isolated-run.js";
import { loadSettings } from "./settings-store.js";
import { resolveWorkspaceRoot } from "./workspace-path.js";
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
  isRunActive,
  startGoalRun,
} from "./run-service.js";
import { broadcast } from "./sse.js";
import {
  markGoalComplete,
  markGoalFailed,
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

function ensureExecutors() {
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
    onComplete: async (resultSummary: string, deliverables?) => {
      const g = getGoalById(goalId);
      if (!g || g.status !== "running") return;
      clearGoalCancelledForConnect(goalId);
      markGoalComplete(goalId, resultSummary, deliverables);
      // 动态 import 避免 orchestrator ↔ goal-actions 循环依赖
      const { maybeAutoReview } = await import("./auto-review.js");
      void maybeAutoReview(goalId);
    },
    onFail: async (errorMessage: string) => {
      const g = getGoalById(goalId);
      if (!g || g.status !== "running") return;
      clearGoalCancelledForConnect(goalId);
      markGoalFailed(goalId, errorMessage);
    },
  };
}

function resolveWorkspaceForGoal(goal: { conversationId: string }): string {
  const settings = loadSettings();
  const projectDir = getWorkspaceDirForConversation(goal.conversationId);
  return resolveWorkspaceRoot(projectDir ?? resolveSystemWorkspaceRoot(settings));
}

function buildExecutorContext(goalId: string, isRework?: boolean) {
  const goal = getGoalById(goalId);
  if (!goal) throw new Error("Goal not found");
  const settings = loadSettings();
  const priorLogs = listLogs(goalId, 30).map((l) => ({
    level: l.level,
    message: l.message,
  }));
  const priorSummaries = listExecutionSummaries(goalId, 10);
  const priorReviewRounds = listReviewRounds(goalId, 8);
  const workspaceRoot = resolveWorkspaceForGoal(goal);
  const dispatch = goal.dispatchContext;
  const { hints: enabledSkills } = resolveExecutorSkills(
    goal.executorId,
    settings,
    dispatch?.skillIds,
  );
  const mcpServers = resolveDispatchMcpServers(settings, dispatch?.mcpIds);
  const agentRole = resolveDispatchAgentRole(settings, dispatch?.agentId);
  let spawnEnv: Record<string, string> | undefined;
  if (isAcpCliConfigTarget(goal.executorId)) {
    const modelRef = settings.acpCli?.[goal.executorId];
    if (modelRef) {
      const creds = resolveAcpCliCredentialsFromRef(settings, modelRef);
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
    goal,
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
    spawnEnv,
    callbacks: buildCallbacks(goalId),
  };
}

/** 依赖已满足的 draft 子目标自动启动（approve 后触发，不依赖 autoExecute 开关） */
export function tryDispatchDependents(completedGoalId: string): void {
  const candidates = listRunnableDraftGoals().filter((g) =>
    g.dependsOn.includes(completedGoalId),
  );

  for (const child of candidates) {
    if (!canTransition(child.status, "running")) continue;
    child.status = "running";
    child.progress = 0;
    child.updatedAt = new Date().toISOString();
    updateGoal(child);
    broadcast({ type: "goal.updated", goal: child });
    narrateGoalChange(child, "start");
    appendLog(child.id, "info", `依赖 ${completedGoalId} 已完成，自动启动`);
    void dispatchGoal(child.id);
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
    startGoalRun(goalId, goal.executorId);
    const ctx = buildExecutorContext(goalId, true);
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
    });
    appendLog(goalId, "info", `Pi 自动选择执行器：${chosen}`);
  }

  goal.executorId = chosen;
  goal.updatedAt = new Date().toISOString();
  updateGoal(goal);
  broadcast({ type: "goal.updated", goal });
}

function getServerBaseUrl(): string {
  const host = process.env.HOST ?? "127.0.0.1";
  const port = process.env.PORT ?? "3921";
  return `http://${host}:${port}`;
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

    if (resolved.status !== "running") {
      appendLog(goalId, "warn", `派发跳过：目标状态为 ${resolved.status}`);
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
    startGoalRun(goalId, resolved.executorId);

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
