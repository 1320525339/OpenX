import type { GoalStatus, IntegrationRun } from "@openx/shared";
import { nanoid } from "nanoid";
import type { Conversation } from "@openx/shared";
import {
  laneToEventLabel,
  mapGoalStatusToTraceStatus,
  mapGoalStatusToTurnStatus,
  mapIntegrationRunToTurnStatus,
  milocoMessageNeedsEscalation,
  resolveIntegrationRunTraceStatus,
  MILOCO_EVENTS_CONVERSATION_ID,
  resolveMilocoLanePolicy,
  type MilocoTraceStatus,
  type MilocoTurnStatus,
} from "@openx/shared";
import {
  getConversationById,
  getGoalById,
  insertConversation,
  insertGoal,
  listGoals,
  updateGoal,
} from "./db.js";
import { claimGoalForDispatch } from "./goal-lifecycle.js";
import { dispatchGoal } from "./orchestrator.js";
import { loadSettings } from "./settings-store.js";
import { broadcast } from "./sse.js";
import { buildPendingSuggestionBlock } from "./miloco-habit-suggest-service.js";
import {
  SYSTEM_PROJECT_ID,
  ensureSystemProject,
} from "./system-workspace.js";
import { approveGoal } from "./goal-actions.js";
import {
  countActiveIntegrationRuns,
  getIntegrationIdempotency,
  getIntegrationRunById,
  getIntegrationRunByIdempotency,
  insertIntegrationRun,
  listIntegrationRuns,
  updateIntegrationRun,
  upsertIntegrationIdempotency,
} from "./integration-run-store.js";

export type MilocoAgentTurnPayload = {
  message: string;
  sessionKey: string;
  lane: string;
  traceId: string;
  idempotencyKey: string;
  timeoutMs: number;
  /** 同步等待 Pi 完成（兼容旧 Dispatcher / smoke） */
  wait?: boolean;
};

/** 解析幂等键：优先 idempotencyKey，其次 traceId；二者皆空则返回 null（禁止空串入库） */
export function resolveMilocoIdempotencyKey(payload: {
  idempotencyKey?: string | null;
  traceId?: string | null;
}): string | null {
  const fromIdem = payload.idempotencyKey?.trim();
  if (fromIdem) return fromIdem;
  const fromTrace = payload.traceId?.trim();
  if (fromTrace) return fromTrace;
  return null;
}

/** 服务端兜底唯一键；绝不能用空字符串做幂等键 */
export function ensureMilocoIdempotencyKey(payload: {
  idempotencyKey?: string | null;
  traceId?: string | null;
}): string {
  return resolveMilocoIdempotencyKey(payload) ?? `server:${nanoid()}`;
}

export type MilocoAgentTurnResult = {
  runId: string;
  status: MilocoTurnStatus | "accepted";
  error?: string;
};

export type MilocoGetTraceResult = {
  status: MilocoTraceStatus;
};

const TERMINAL_GOAL_STATUSES: ReadonlySet<GoalStatus> = new Set([
  "awaiting_review",
  "done",
  "failed",
  "cancelled",
]);

const INTEGRATION_ID = "miloco";
const LANE_CONCURRENCY: Record<string, number> = {
  "miloco-interactive": 2,
  "miloco-suggest": 1,
  "miloco-rule": 1,
};
const MAX_BACKLOG = 40;
const INTERACTIVE_DEDUP_MS = 30_000;
const recentInteractiveByRoomCommand = new Map<string, number>();
const inflightRuns = new Map<string, Promise<MilocoAgentTurnResult>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 从 Miloco event_text_builder 竖排文本提取字段（测试/去重用） */
export function extractMilocoEventField(message: string, field: string): string {
  const re = new RegExp(`^${field}：(.+)$`, "m");
  return message.match(re)?.[1]?.trim() ?? "";
}

/** 30s 内同房间同语音指令去重（测试可直调） */
export function isDuplicateInteractive(payload: MilocoAgentTurnPayload): boolean {
  if (payload.lane !== "miloco-interactive") return false;
  const room = extractMilocoEventField(payload.message, "来源");
  const command = extractMilocoEventField(payload.message, "语音指令") || payload.message.trim();
  const key = `${room}|${command}`;
  const now = Date.now();
  const last = recentInteractiveByRoomCommand.get(key);
  if (last !== undefined && now - last < INTERACTIVE_DEDUP_MS) return true;
  recentInteractiveByRoomCommand.set(key, now);
  for (const [k, ts] of recentInteractiveByRoomCommand) {
    if (now - ts >= INTERACTIVE_DEDUP_MS) recentInteractiveByRoomCommand.delete(k);
  }
  return false;
}

function summarizeMessage(message: string, maxLen = 48): string {
  const firstLine = message.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
  const cleaned = firstLine.replace(/^\[[^\]]+\]\s*/, "").trim();
  if (cleaned.length <= maxLen) return cleaned || "Miloco 感知事件";
  return `${cleaned.slice(0, maxLen)}…`;
}

export function buildGoalDraft(payload: MilocoAgentTurnPayload): {
  title: string;
  acceptance: string;
  executionPrompt: string;
  userDraft: string;
} {
  const eventLabel = laneToEventLabel(payload.lane);
  const summary = summarizeMessage(payload.message);
  const title = `[Miloco] ${eventLabel}：${summary}`;
  const isInteractive = payload.lane === "miloco-interactive";
  const policy = resolveMilocoLanePolicy(payload.lane);

  const acceptance = isInteractive
    ? [
        "已根据用户口头指令完成判断与处置：",
        "- 需要口头反馈时，通过 miloco-notify → 事发房间音箱 play-text 播报（短句、口语）",
        "- 需要查询/控制设备时，通过 miloco-devices / miloco-miot-* 执行",
        "- 除非用户明确要求「让小爱去做」，否则禁止使用 execute-text-directive",
        "- 若无法执行，也要用音箱简短说明原因",
      ].join("\n")
    : [
        "已根据 Miloco 感知事件完成判断与处置：",
        "- 需要主动触达用户时，通过 miloco-notify 选择合适渠道播报",
        "- 需要查询/控制设备时，通过 miloco-devices / miloco-miot-* 执行",
        "- 若事件无需行动，在结果中说明原因",
        `- 当前 lane 权限：${policy.permissionMode}；仅使用授权 Skills`,
      ].join("\n");

  const sharedExecutionTail = [
    "- 所有 miloco-cli 命令经 miloco-wsl.ps1 包装执行",
    "- 危险操作（多台设备、不可逆动作、删除任务）须停止并请求用户确认",
    `- 仅允许 Skills：${policy.skillIds.join(", ")}`,
  ];

  const executionPrompt = isInteractive
    ? [
        "【Miloco 语音交互】",
        `lane: ${payload.lane}`,
        `sessionKey: ${payload.sessionKey}`,
        `traceId: ${payload.traceId}`,
        "",
        "原始事件内容：",
        payload.message,
        "",
        "执行指引：",
        "- 这是对管家的直接口头指令（非被动告警），优先理解「语音指令」字段",
        "- 设备控制/查询走 miloco-devices、miloco-miot-scope、miloco-miot-admin",
        "- 需要口头回复时，必须走 miloco-notify → 事发房间（来源字段）音箱 play-text，文案短、口语",
        "- 禁止默认 execute-text-directive（那是代发小爱指令，大脑仍是小爱）",
        "- 用户说「小爱同学 xxx」时，由 OpenX/Pi 自行理解执行，不要转给小爱云端",
        ...sharedExecutionTail,
      ].join("\n")
    : [
        "【Miloco 主动事件】",
        `lane: ${payload.lane}`,
        `sessionKey: ${payload.sessionKey}`,
        `traceId: ${payload.traceId}`,
        "",
        ...(payload.lane === "miloco-suggest" ? [buildPendingSuggestionBlock(), ""] : []),
        "原始事件内容：",
        payload.message,
        "",
        "执行指引：",
        "- 这是 Miloco 感知引擎的主动事件，请判断是否需要通知用户或控制设备",
        "- 主动触达走 miloco-notify；设备查询/控制走授权范围内的 miloco-devices / miot-*",
        ...sharedExecutionTail,
      ].join("\n");

  return {
    title,
    acceptance,
    executionPrompt,
    userDraft: payload.message,
  };
}

/** 在系统项目下惰性创建 Miloco 感知事件专用会话 */
export function ensureMilocoEventConversation(): Conversation {
  ensureSystemProject();
  let conversation = getConversationById(MILOCO_EVENTS_CONVERSATION_ID);
  if (!conversation) {
    const now = new Date().toISOString();
    conversation = insertConversation({
      id: MILOCO_EVENTS_CONVERSATION_ID,
      projectId: SYSTEM_PROJECT_ID,
      title: "Miloco 感知事件",
      createdAt: now,
      updatedAt: now,
    });
  }
  return conversation;
}

/** 轮询预算：对齐 webhook timeoutMs 与 Pi runTimeoutMs */
export function resolveWebhookPollBudgetMs(timeoutMs: number): number {
  const settings = loadSettings();
  const piRunTimeoutMs = settings.executors?.pi?.runTimeoutMs ?? 600_000;
  const fromWebhook = Math.min(timeoutMs - 5_000, Math.floor(timeoutMs * 0.95));
  const cap = Math.min(fromWebhook, piRunTimeoutMs);
  return Math.max(5_000, cap);
}

function finishRun(
  run: IntegrationRun,
  status: IntegrationRun["status"],
  extra?: Partial<IntegrationRun>,
): IntegrationRun {
  const now = new Date().toISOString();
  const next: IntegrationRun = {
    ...run,
    ...extra,
    status,
    updatedAt: now,
    finishedAt:
      status === "succeeded" ||
      status === "failed" ||
      status === "needs_attention"
        ? now
        : run.finishedAt,
  };
  updateIntegrationRun(next);
  upsertIntegrationIdempotency({
    integrationId: INTEGRATION_ID,
    idempotencyKey: next.idempotencyKey,
    runId: next.id,
    status: next.status,
  });
  return next;
}

async function pollGoalUntilTerminal(
  run: IntegrationRun,
  goalId: string,
  timeoutMs: number,
  autoComplete: boolean,
): Promise<MilocoAgentTurnResult> {
  const pollBudgetMs = resolveWebhookPollBudgetMs(timeoutMs);
  const deadline = Date.now() + pollBudgetMs;
  const intervalMs = 500;

  while (Date.now() < deadline) {
    const goal = getGoalById(goalId);
    if (!goal) {
      finishRun(run, "failed", { error: "Goal not found after dispatch", goalId });
      return { runId: run.id, status: "error", error: "Goal not found after dispatch" };
    }
    if (TERMINAL_GOAL_STATUSES.has(goal.status)) {
      if (goal.status === "awaiting_review" && autoComplete) {
        const approved = approveGoal(goalId, { source: "auto" });
        if (approved.ok) {
          finishRun(run, "succeeded", {
            goalId,
            summary: goal.resultSummary ?? "自动完成",
          });
          return { runId: run.id, status: "ok" };
        }
        // 门禁失败：记为 needs_attention，避免永久污染待验收时可人工处理
        finishRun(run, "needs_attention", {
          goalId,
          summary: goal.resultSummary,
          error: approved.error,
        });
        return { runId: run.id, status: "ok" };
      }
      if (goal.status === "awaiting_review") {
        finishRun(run, "needs_attention", {
          goalId,
          summary: goal.resultSummary,
        });
        return { runId: run.id, status: "ok" };
      }
      if (goal.status === "done") {
        finishRun(run, "succeeded", { goalId, summary: goal.resultSummary });
        return { runId: run.id, status: "ok" };
      }
      const status = mapGoalStatusToTurnStatus(goal.status);
      finishRun(run, status === "error" ? "failed" : "succeeded", {
        goalId,
        error: status === "error" ? goal.resultSummary ?? "Goal failed" : undefined,
        summary: goal.resultSummary,
      });
      return {
        runId: run.id,
        status,
        error: status === "error" ? goal.resultSummary ?? "Goal failed" : undefined,
      };
    }
    await sleep(intervalMs);
  }

  finishRun(run, "failed", { goalId, error: "Pi turn did not complete within timeout" });
  return { runId: run.id, status: "timeout", error: "Pi turn did not complete within timeout" };
}

async function executeMilocoAgentTurn(
  payload: MilocoAgentTurnPayload,
  existingRun?: IntegrationRun,
): Promise<MilocoAgentTurnResult> {
  const policy = resolveMilocoLanePolicy(payload.lane);
  const escalate =
    policy.escalateByDefault || milocoMessageNeedsEscalation(payload.message);
  const draft = buildGoalDraft(payload);
  const now = new Date().toISOString();
  const sourceKey =
    payload.lane === "miloco-interactive"
      ? `interactive:${extractMilocoEventField(payload.message, "来源")}|${extractMilocoEventField(payload.message, "语音指令") || payload.message.slice(0, 80)}`
      : `${payload.lane}:${payload.sessionKey || payload.traceId}`;

  let run = existingRun;
  if (!run) {
    run = {
      id: nanoid(),
      integrationId: INTEGRATION_ID,
      lane: payload.lane || "unknown",
      sourceKey,
      traceId: payload.traceId,
      idempotencyKey: ensureMilocoIdempotencyKey(payload),
      status: "running",
      title: draft.title,
      inputJson: JSON.stringify({
        sessionKey: payload.sessionKey,
        message: payload.message.slice(0, 4_000),
      }),
      payloadJson: JSON.stringify({
        sessionKey: payload.sessionKey,
        message: payload.message.slice(0, 4_000),
      }),
      createdAt: now,
      updatedAt: now,
    };
    try {
      insertIntegrationRun(run);
    } catch {
      const raced = getIntegrationRunByIdempotency(
        INTEGRATION_ID,
        run.idempotencyKey,
      );
      if (raced) {
        return {
          runId: raced.id,
          status: mapIntegrationRunToTurnStatus(raced.status),
        };
      }
      throw new Error("failed to insert integration run");
    }
    upsertIntegrationIdempotency({
      integrationId: INTEGRATION_ID,
      idempotencyKey: run.idempotencyKey,
      runId: run.id,
      status: run.status,
    });
  } else {
    run = {
      ...run,
      status: "running",
      sourceKey: run.sourceKey ?? sourceKey,
      updatedAt: now,
      title: draft.title,
    };
    updateIntegrationRun(run);
  }

  const skillIds = [...policy.skillIds];

  // 普通自动化：不写 Goal，走 ExecutionWorkItem
  if (!escalate) {
    const { executeIntegrationWorkItem } = await import("./execution-work-item.js");
    const result = await executeIntegrationWorkItem(run, {
      id: run.id,
      kind: "integration_run",
      integrationId: INTEGRATION_ID,
      title: draft.title,
      executionPrompt: draft.executionPrompt,
      skillIds,
      permissionMode: policy.permissionMode,
      conversationId: MILOCO_EVENTS_CONVERSATION_ID,
      timeoutMs: payload.timeoutMs,
    });
    return {
      runId: run.id,
      status: result.ok ? "ok" : "error",
      error: result.error,
    };
  }

  // 危险操作：升级为可见 Goal（needs_attention）
  const conversation = ensureMilocoEventConversation();
  const goalId = nanoid();

  const goal = {
    id: goalId,
    orderNo: 0,
    conversationId: conversation.id,
    title: draft.title,
    acceptance: draft.acceptance,
    userDraft: draft.userDraft,
    executionPrompt: draft.executionPrompt,
    constraints: [] as string[],
    executorId: "pi" as const,
    dependsOn: [] as string[],
    priority: "high" as const,
    autoReview: false,
    iterationCount: 0,
    dispatchContext: {
      skillIds,
      permissionMode: policy.permissionMode,
    },
    foremanThreadId: conversation.id,
    status: "draft" as const,
    progress: 0,
    createdAt: now,
    updatedAt: now,
  };

  insertGoal(goal);
  broadcast({ type: "goal.updated", goal });

  run = finishRun(run, "needs_attention", { goalId, summary: "已升级为待确认 Goal" });
  broadcast({
    type: "integration.run.updated",
    integrationId: INTEGRATION_ID,
    runId: run.id,
    status: "needs_attention",
    title: run.title,
    lane: run.lane,
    goalId,
    timestamp: new Date().toISOString(),
  });

  const claimed = claimGoalForDispatch(goalId, ["draft"]);
  if (!claimed) {
    return { runId: run.id, status: "error", error: "Failed to claim goal for dispatch" };
  }

  broadcast({ type: "goal.updated", goal: claimed });
  void dispatchGoal(goalId);

  if (payload.wait === false) {
    return { runId: run.id, status: "ok" };
  }
  return pollGoalUntilTerminal(run, goalId, payload.timeoutMs, false);
}

function checkLaneCapacity(lane: string): { ok: boolean; error?: string } {
  const limit = LANE_CONCURRENCY[lane] ?? 2;
  const active = countActiveIntegrationRuns(INTEGRATION_ID, lane);
  if (active >= limit) {
    return { ok: false, error: `lane ${lane} 并发已满（${active}/${limit}）` };
  }
  const total = countActiveIntegrationRuns(INTEGRATION_ID);
  if (total >= MAX_BACKLOG) {
    return { ok: false, error: `Miloco 运行积压已达上限（${MAX_BACKLOG}）` };
  }
  return { ok: true };
}

/**
 * 入队 Miloco agent turn：立即返回 runId。
 * 后台执行；若 wait=true 则由调用方 await 同一 Promise。
 */
export function enqueueMilocoAgentTurn(
  payload: MilocoAgentTurnPayload,
): { runId: string; status: "accepted" | MilocoTurnStatus; error?: string; promise: Promise<MilocoAgentTurnResult> } {
  if (isDuplicateInteractive(payload)) {
    const runId = `dedup-${payload.traceId || nanoid()}`;
    return {
      runId,
      status: "ok",
      promise: Promise.resolve({ runId, status: "ok" }),
    };
  }

  const key = ensureMilocoIdempotencyKey(payload);
  const existingIdem = getIntegrationIdempotency(INTEGRATION_ID, key);
  if (existingIdem) {
    const existingRun = getIntegrationRunById(existingIdem.runId);
    if (existingRun) {
      const inflight = inflightRuns.get(existingRun.id);
      if (inflight) {
        return {
          runId: existingRun.id,
          status: "accepted",
          promise: inflight,
        };
      }
      const terminal =
        existingRun.status === "succeeded" ||
        existingRun.status === "failed" ||
        existingRun.status === "needs_attention";
      if (terminal) {
        return {
          runId: existingRun.id,
          status: mapIntegrationRunToTurnStatus(existingRun.status),
          error: existingRun.error,
          promise: Promise.resolve({
            runId: existingRun.id,
            status: mapIntegrationRunToTurnStatus(existingRun.status),
            error: existingRun.error,
          }),
        };
      }
    }
  }

  const capacity = checkLaneCapacity(payload.lane);
  if (!capacity.ok) {
    const runId = nanoid();
    const now = new Date().toISOString();
    const dropped: IntegrationRun = {
      id: runId,
      integrationId: INTEGRATION_ID,
      lane: payload.lane || "unknown",
      traceId: payload.traceId,
      idempotencyKey: key,
      status: "failed",
      title: `[Miloco] 丢弃：${summarizeMessage(payload.message)}`,
      error: capacity.error,
      createdAt: now,
      updatedAt: now,
      finishedAt: now,
    };
    try {
      insertIntegrationRun(dropped);
    } catch {
      /* ignore unique race */
    }
    return {
      runId,
      status: "error",
      error: capacity.error,
      promise: Promise.resolve({ runId, status: "error", error: capacity.error }),
    };
  }

  const now = new Date().toISOString();
  const runId = nanoid();
  const draftTitle = `[Miloco] ${laneToEventLabel(payload.lane)}：${summarizeMessage(payload.message)}`;
  const run: IntegrationRun = {
    id: runId,
    integrationId: INTEGRATION_ID,
    lane: payload.lane || "unknown",
    traceId: payload.traceId,
    idempotencyKey: key,
    status: "accepted",
    title: draftTitle,
    createdAt: now,
    updatedAt: now,
  };

  try {
    insertIntegrationRun(run);
  } catch {
    const raced = getIntegrationRunByIdempotency(INTEGRATION_ID, key);
    if (raced) {
      return {
        runId: raced.id,
        status: mapIntegrationRunToTurnStatus(raced.status),
        promise: Promise.resolve({
          runId: raced.id,
          status: mapIntegrationRunToTurnStatus(raced.status),
        }),
      };
    }
  }

  upsertIntegrationIdempotency({
    integrationId: INTEGRATION_ID,
    idempotencyKey: key,
    runId,
    status: "accepted",
  });

  const promise = executeMilocoAgentTurn(payload, run).finally(() => {
    inflightRuns.delete(runId);
  });
  inflightRuns.set(runId, promise);

  return { runId, status: "accepted", promise };
}

/** 兼容旧调用：默认同步等待 */
export function handleMilocoAgentTurn(
  payload: MilocoAgentTurnPayload,
): Promise<MilocoAgentTurnResult> {
  const enqueued = enqueueMilocoAgentTurn(payload);
  if (payload.wait === false) {
    return Promise.resolve({
      runId: enqueued.runId,
      status: enqueued.status === "accepted" ? "accepted" : enqueued.status,
      error: enqueued.error,
    });
  }
  return enqueued.promise;
}

/** 处理 Miloco get_trace */
export function handleMilocoGetTrace(runId: string): MilocoGetTraceResult {
  const run = getIntegrationRunById(runId);
  if (run) {
    const goal = run.goalId ? getGoalById(run.goalId) : null;
    return {
      status: resolveIntegrationRunTraceStatus(run.status, goal?.status ?? null),
    };
  }
  // 兼容旧 runId = goalId
  const goal = getGoalById(runId);
  if (!goal) return { status: "unknown" };
  return { status: mapGoalStatusToTraceStatus(goal.status) };
}

/** 事件时间线：优先 integration_runs */
export function listMilocoEventRuns(limit = 50, lane?: string) {
  return listIntegrationRuns({
    integrationId: INTEGRATION_ID,
    lane,
    limit,
  }).map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    lane: r.lane,
    goalId: r.goalId,
  }));
}

/** 一次性：将历史 awaiting_review 的 Miloco 自动化 Goal 豁免完成 */
export function migrateMilocoAwaitingReviewGoals(): number {
  const goals = listGoals({ conversationId: MILOCO_EVENTS_CONVERSATION_ID }).filter(
    (g) => g.status === "awaiting_review",
  );
  let n = 0;
  for (const goal of goals) {
    const approved = approveGoal(goal.id, { source: "auto" });
    if (approved.ok) {
      n += 1;
      continue;
    }
    // 门禁卡住时强制标为已完成并豁免
    goal.status = "done";
    goal.waived = true;
    goal.updatedAt = new Date().toISOString();
    updateGoal(goal);
    n += 1;
  }
  return n;
}

/** 测试用：清空幂等缓存 */
export function resetMilocoWebhookIdempotencyForTests(): void {
  recentInteractiveByRoomCommand.clear();
  inflightRuns.clear();
}
