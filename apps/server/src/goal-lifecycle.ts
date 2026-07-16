import {
  canTransition,
  validateGoalCompletion,
  type Goal,
  type GoalDeliverable,
  type GoalStatus,
  type LogLevel,
} from "@openx/shared";
import {
  appendLog,
  casUpdateGoal,
  getGoalById,
  GoalRevisionConflictError,
  listExecutionSummaries,
  runGoalDbTransaction,
  saveExecutionSummary,
  transitionGoalStatus,
} from "./db.js";
import { narrateGoalChange } from "./narration.js";
import { endGoalRun, emitGoalRunEvent } from "./run-service.js";
import { broadcast, fanoutSse, persistSseEvent } from "./sse.js";
import { checkGoalCompleteGate } from "./goal-completion-gate.js";
import { resolveAttentionsForGoal } from "./attention-store.js";
import {
  islandForAwaitingReview,
  islandForFailed,
  pushIsland,
} from "./island-push.js";

export type LifecycleError = {
  ok: false;
  status: 400 | 404 | 409;
  error: string;
  currentRevision?: number;
};
export type LifecycleOk<T = void> = { ok: true; goal: Goal; data?: T };
export type LifecycleResult<T = void> = LifecycleOk<T> | LifecycleError;

function fail(
  status: LifecycleError["status"],
  error: string,
  currentRevision?: number,
): LifecycleError {
  return { ok: false, status, error, currentRevision };
}

function isLifecycleError(v: Goal | LifecycleError): v is LifecycleError {
  return "ok" in v && v.ok === false;
}

function requireGoal(goalId: string): Goal | LifecycleError {
  const goal = getGoalById(goalId);
  if (!goal) return fail(404, "Not found");
  return goal;
}

function requireTransition(goal: Goal, to: GoalStatus): LifecycleError | null {
  if (!canTransition(goal.status, to)) {
    return fail(409, `Cannot transition from ${goal.status} to ${to}`);
  }
  return null;
}

function conflictFromCas(err: unknown): LifecycleError {
  if (err instanceof GoalRevisionConflictError) {
    return fail(409, "Goal revision conflict", err.currentRevision);
  }
  throw err;
}

export function updateGoalProgress(
  goalId: string,
  progress: number,
  message?: string,
): LifecycleResult {
  const goalOrErr = requireGoal(goalId);
  if (isLifecycleError(goalOrErr)) return goalOrErr;
  const goal = goalOrErr;

  if (goal.status !== "running") {
    return fail(409, `Goal is not running (${goal.status})`);
  }

  const next: Goal = {
    ...goal,
    progress,
    updatedAt: new Date().toISOString(),
  };

  try {
    const pending: ReturnType<typeof persistSseEvent>[] = [];
    const updated = runGoalDbTransaction(() => {
      const saved = casUpdateGoal(next, { expectedStatuses: ["running"] });
      pending.push(persistSseEvent({ type: "goal.updated", goal: saved }));
      if (message) {
        const log = appendLog(goalId, "info", message);
        pending.push(
          persistSseEvent({ type: "log.append", goalId, ...log }),
        );
      }
      return saved;
    });
    for (const stored of pending) fanoutSse(stored);
    if (message) {
      emitGoalRunEvent(goalId, {
        type: "status",
        message,
        timestamp: new Date().toISOString(),
      });
    }
    return { ok: true, goal: updated };
  } catch (err) {
    return conflictFromCas(err);
  }
}

export function markGoalComplete(
  goalId: string,
  resultSummary: string,
  deliverables?: GoalDeliverable[],
): LifecycleResult {
  const goalOrErr = requireGoal(goalId);
  if (isLifecycleError(goalOrErr)) return goalOrErr;
  const goal = goalOrErr;

  const transitionErr = requireTransition(goal, "awaiting_review");
  if (transitionErr) return transitionErr;

  const gate = checkGoalCompleteGate(goalId);
  if (!gate.ok) {
    return fail(409, gate.error);
  }

  const validation = validateGoalCompletion(resultSummary, deliverables);
  if (!validation.ok) {
    const failed = markGoalFailed(goalId, validation.message);
    if (!failed.ok) return failed;
    return fail(400, validation.message);
  }

  const draft: Goal = {
    ...goal,
    status: "awaiting_review",
    effectStatus: undefined,
    progress: 100,
    resultSummary,
    deliverables:
      deliverables && deliverables.length > 0 ? deliverables : undefined,
    updatedAt: new Date().toISOString(),
  };

  try {
    const pending: ReturnType<typeof persistSseEvent>[] = [];
    const updated = runGoalDbTransaction(() => {
      const saved = casUpdateGoal(draft, { expectedStatuses: ["running"] });
      saveExecutionSummary(goalId, resultSummary, saved.executorId);
      pending.push(persistSseEvent({ type: "goal.updated", goal: saved }));
      return saved;
    });
    endGoalRun(goalId, "completed", resultSummary);
    for (const stored of pending) fanoutSse(stored);
    narrateGoalChange(updated, "review");
    pushIsland(islandForAwaitingReview(updated));
    return { ok: true, goal: updated };
  } catch (err) {
    return conflictFromCas(err);
  }
}

export function markGoalFailed(
  goalId: string,
  errorMessage: string,
): LifecycleResult {
  const goalOrErr = requireGoal(goalId);
  if (isLifecycleError(goalOrErr)) return goalOrErr;
  const goal = goalOrErr;

  const transitionErr = requireTransition(goal, "failed");
  if (transitionErr) return transitionErr;

  const draft: Goal = {
    ...goal,
    status: "failed",
    updatedAt: new Date().toISOString(),
  };

  try {
    const pending: ReturnType<typeof persistSseEvent>[] = [];
    const updated = runGoalDbTransaction(() => {
      const saved = casUpdateGoal(draft, {
        expectedStatuses: [goal.status],
      });
      const log = appendLog(goalId, "error", errorMessage);
      pending.push(persistSseEvent({ type: "goal.updated", goal: saved }));
      pending.push(persistSseEvent({ type: "log.append", goalId, ...log }));
      return saved;
    });
    endGoalRun(goalId, "failed", errorMessage);
    for (const stored of pending) fanoutSse(stored);
    narrateGoalChange(updated, "fail");
    resolveAttentionsForGoal(goalId, [
      "goal.awaiting_review",
      "goal.review_limit",
      "goal.review_unavailable",
      "goal.review_fail",
      "goal.gate_blocked",
    ]);
    pushIsland(islandForFailed(updated, errorMessage));
    return { ok: true, goal: updated };
  } catch (err) {
    return conflictFromCas(err);
  }
}

export function appendGoalLog(
  goalId: string,
  level: LogLevel,
  message: string,
): LifecycleResult {
  const goalOrErr = requireGoal(goalId);
  if (isLifecycleError(goalOrErr)) return goalOrErr;

  const log = appendLog(goalId, level, message);
  broadcast({ type: "log.append", goalId, ...log });
  return { ok: true, goal: goalOrErr };
}

export function cancelGoalStatus(
  goalId: string,
  opts?: { reason?: string; source?: string },
): LifecycleResult {
  const goalOrErr = requireGoal(goalId);
  if (isLifecycleError(goalOrErr)) return goalOrErr;
  const goal = goalOrErr;

  const transitionErr = requireTransition(goal, "cancelled");
  if (transitionErr) return transitionErr;

  const draft: Goal = {
    ...goal,
    status: "cancelled",
    crewStatus: undefined,
    updatedAt: new Date().toISOString(),
  };

  const reason = opts?.reason?.trim();
  const source = opts?.source?.trim();
  const logMsg = [
    "任务已终止",
    source ? `来源：${source}` : null,
    reason ? `原因：${reason}` : null,
  ]
    .filter(Boolean)
    .join("；");

  try {
    const pending: ReturnType<typeof persistSseEvent>[] = [];
    const updated = runGoalDbTransaction(() => {
      const saved = casUpdateGoal(draft, { expectedStatuses: [goal.status] });
      const log = appendLog(goalId, "warn", logMsg);
      pending.push(persistSseEvent({ type: "goal.updated", goal: saved }));
      pending.push(persistSseEvent({ type: "log.append", goalId, ...log }));
      return saved;
    });
    for (const stored of pending) fanoutSse(stored);
    narrateGoalChange(updated, "cancel");
    return { ok: true, goal: updated };
  } catch (err) {
    return conflictFromCas(err);
  }
}

/** 将执行中目标正式暂停为 paused（等待开发商决策） */
export function parkGoalAsPaused(
  goalId: string,
  checkpointSummary?: string,
): LifecycleResult {
  const goalOrErr = requireGoal(goalId);
  if (isLifecycleError(goalOrErr)) return goalOrErr;
  const goal = goalOrErr;

  if (goal.status === "paused") {
    return { ok: true, goal };
  }

  const transitionErr = requireTransition(goal, "paused");
  if (transitionErr) return transitionErr;

  const draft: Goal = {
    ...goal,
    status: "paused",
    crewStatus: "awaiting_user",
    updatedAt: new Date().toISOString(),
  };

  try {
    const pending: ReturnType<typeof persistSseEvent>[] = [];
    const updated = runGoalDbTransaction(() => {
      const saved = casUpdateGoal(draft, { expectedStatuses: ["running"] });
      const log = appendLog(
        goalId,
        "info",
        checkpointSummary?.trim()
          ? `工头已暂停施工队，等待开发商决策：${checkpointSummary.trim()}`
          : "工头已暂停施工队，等待开发商决策（任务单未交差）",
      );
      pending.push(persistSseEvent({ type: "goal.updated", goal: saved }));
      pending.push(persistSseEvent({ type: "log.append", goalId, ...log }));
      return saved;
    });
    endGoalRun(goalId, "paused", checkpointSummary);
    for (const stored of pending) fanoutSse(stored);
    narrateGoalChange(updated, "pause");
    return { ok: true, goal: updated };
  } catch (err) {
    return conflictFromCas(err);
  }
}

/** 从 paused 恢复为 running（续跑前） */
export function claimPausedGoalForResume(goalId: string): Goal | null {
  return transitionGoalStatus(goalId, ["paused"], "running");
}

/** CAS 式将目标迁移到 running（用于派发防竞态）；progress 并入同条 UPDATE */
export function claimGoalForDispatch(
  goalId: string,
  fromStatuses: GoalStatus[],
): Goal | null {
  return transitionGoalStatus(goalId, fromStatuses, "running", { progress: 0 });
}

export function listPriorSummariesForGoal(goalId: string, limit = 3): string[] {
  return listExecutionSummaries(goalId, limit);
}
