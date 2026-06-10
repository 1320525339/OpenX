import { canTransition, type Goal, type GoalStatus, type LogLevel } from "@openx/shared";
import {
  appendLog,
  getGoalById,
  listExecutionSummaries,
  saveExecutionSummary,
  transitionGoalStatus,
  updateGoal,
} from "./db.js";
import { narrateGoalChange } from "./narration.js";
import { endGoalRun, emitGoalRunEvent } from "./run-service.js";
import { broadcast } from "./sse.js";

export type LifecycleError = {
  ok: false;
  status: 400 | 404 | 409;
  error: string;
};
export type LifecycleOk<T = void> = { ok: true; goal: Goal; data?: T };
export type LifecycleResult<T = void> = LifecycleOk<T> | LifecycleError;

function fail(status: LifecycleError["status"], error: string): LifecycleError {
  return { ok: false, status, error };
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

  goal.progress = progress;
  goal.updatedAt = new Date().toISOString();
  updateGoal(goal);
  broadcast({ type: "goal.updated", goal });

  if (message) {
    const log = appendLog(goalId, "info", message);
    broadcast({ type: "log.append", goalId, ...log });
    emitGoalRunEvent(goalId, {
      type: "status",
      message,
      timestamp: new Date().toISOString(),
    });
  }

  return { ok: true, goal };
}

export function markGoalComplete(
  goalId: string,
  resultSummary: string,
): LifecycleResult {
  const goalOrErr = requireGoal(goalId);
  if (isLifecycleError(goalOrErr)) return goalOrErr;
  const goal = goalOrErr;

  const transitionErr = requireTransition(goal, "awaiting_review");
  if (transitionErr) return transitionErr;

  endGoalRun(goalId, "completed", resultSummary);
  goal.status = "awaiting_review";
  goal.progress = 100;
  goal.resultSummary = resultSummary;
  goal.updatedAt = new Date().toISOString();
  updateGoal(goal);
  saveExecutionSummary(goalId, resultSummary, goal.executorId);
  broadcast({ type: "goal.updated", goal });
  narrateGoalChange(goal, "review");
  return { ok: true, goal };
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

  endGoalRun(goalId, "failed", errorMessage);
  goal.status = "failed";
  goal.updatedAt = new Date().toISOString();
  updateGoal(goal);
  const log = appendLog(goalId, "error", errorMessage);
  broadcast({ type: "goal.updated", goal });
  broadcast({ type: "log.append", goalId, ...log });
  narrateGoalChange(goal, "fail");
  return { ok: true, goal };
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

export function cancelGoalStatus(goalId: string): LifecycleResult {
  const goalOrErr = requireGoal(goalId);
  if (isLifecycleError(goalOrErr)) return goalOrErr;
  const goal = goalOrErr;

  const transitionErr = requireTransition(goal, "cancelled");
  if (transitionErr) return transitionErr;

  goal.status = "cancelled";
  goal.updatedAt = new Date().toISOString();
  updateGoal(goal);
  broadcast({ type: "goal.updated", goal });
  return { ok: true, goal };
}

/** CAS 式将目标迁移到 running（用于派发防竞态） */
export function claimGoalForDispatch(
  goalId: string,
  fromStatuses: GoalStatus[],
): Goal | null {
  return transitionGoalStatus(goalId, fromStatuses, "running");
}

export function listPriorSummariesForGoal(goalId: string, limit = 3): string[] {
  return listExecutionSummaries(goalId, limit);
}
