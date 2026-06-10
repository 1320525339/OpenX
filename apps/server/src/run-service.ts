import { nanoid } from "nanoid";
import {
  applyRunStreamEvent,
  createEmptyRunState,
  type GoalRunState,
  type RunDeltaEvent,
  type RunEndStatus,
  type RunStreamEvent,
} from "@openx/shared";
import {
  appendRunEventRecord,
  clearRunEvents,
  listRunEventRecords,
} from "./db.js";
import { broadcast } from "./sse.js";

const activeByGoal = new Map<string, { runId: string; executorId: string }>();

export function getActiveRun(goalId: string): { runId: string; executorId: string } | undefined {
  return activeByGoal.get(goalId);
}

export function isRunActive(goalId: string): boolean {
  return activeByGoal.has(goalId);
}

export function buildRunStateFromDb(goalId: string): GoalRunState {
  const events = listRunEventRecords(goalId);
  let state = createEmptyRunState(goalId);
  for (const event of events) {
    state = applyRunStreamEvent(state, event);
  }
  const active = activeByGoal.get(goalId);
  if (active) {
    state.runId = active.runId;
    state.active = true;
    state.executorId = active.executorId;
  }
  return state;
}

function persistAndBroadcast(goalId: string, runId: string, event: RunStreamEvent) {
  appendRunEventRecord(goalId, runId, event);
  if (event.type === "run.start") {
    broadcast({
      type: "run.started",
      goalId,
      runId,
      executorId: event.executorId,
      timestamp: event.timestamp,
    });
    return;
  }
  if (event.type === "run.end") {
    broadcast({
      type: "run.ended",
      goalId,
      runId,
      status: event.status,
      summary: event.summary,
      timestamp: event.timestamp,
    });
    return;
  }
  broadcast({
    type: "run.event",
    goalId,
    runId,
    event,
  });
}

export function startGoalRun(goalId: string, executorId: string): string {
  const runId = nanoid();
  clearRunEvents(goalId);
  activeByGoal.set(goalId, { runId, executorId });
  const event: RunStreamEvent = {
    type: "run.start",
    runId,
    executorId,
    timestamp: new Date().toISOString(),
  };
  persistAndBroadcast(goalId, runId, event);
  return runId;
}

export function emitGoalRunEvent(goalId: string, event: RunDeltaEvent): void {
  const active = activeByGoal.get(goalId);
  if (!active) return;
  persistAndBroadcast(goalId, active.runId, event as RunStreamEvent);
}

export function endGoalRun(
  goalId: string,
  status: RunEndStatus,
  summary?: string,
): void {
  const active = activeByGoal.get(goalId);
  if (!active) return;
  const event: RunStreamEvent = {
    type: "run.end",
    status,
    summary,
    timestamp: new Date().toISOString(),
  };
  persistAndBroadcast(goalId, active.runId, event);
  activeByGoal.delete(goalId);
}

/** 测试用 */
export function resetRunService(): void {
  activeByGoal.clear();
}
