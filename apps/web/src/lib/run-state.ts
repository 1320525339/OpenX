import type { GoalRunState, RunDeltaEvent, RunEndStatus } from "@openx/shared";
import {
  applyRunDelta,
  applyRunStreamEvent,
  createEmptyRunState,
  type RunStreamEvent,
} from "@openx/shared";

export function getRunState(
  runs: Record<string, GoalRunState>,
  goalId: string,
): GoalRunState {
  return runs[goalId] ?? createEmptyRunState(goalId);
}

export function handleRunStarted(
  runs: Record<string, GoalRunState>,
  payload: { goalId: string; runId: string; executorId: string; timestamp: string },
): Record<string, GoalRunState> {
  const startEvent: RunStreamEvent = {
    type: "run.start",
    runId: payload.runId,
    executorId: payload.executorId,
    timestamp: payload.timestamp,
  };
  return {
    ...runs,
    [payload.goalId]: applyRunStreamEvent(createEmptyRunState(payload.goalId), startEvent),
  };
}

export function handleRunEvent(
  runs: Record<string, GoalRunState>,
  payload: { goalId: string; event: RunDeltaEvent },
): Record<string, GoalRunState> {
  const prev = getRunState(runs, payload.goalId);
  return {
    ...runs,
    [payload.goalId]: applyRunDelta(prev, payload.event),
  };
}

export function handleRunEnded(
  runs: Record<string, GoalRunState>,
  payload: { goalId: string; status: RunEndStatus; summary?: string; timestamp: string },
): Record<string, GoalRunState> {
  const prev = getRunState(runs, payload.goalId);
  const endEvent: RunStreamEvent = {
    type: "run.end",
    status: payload.status,
    summary: payload.summary,
    timestamp: payload.timestamp,
  };
  return {
    ...runs,
    [payload.goalId]: applyRunStreamEvent(prev, endEvent),
  };
}

export function hydrateRunState(
  runs: Record<string, GoalRunState>,
  goalId: string,
  run: GoalRunState,
): Record<string, GoalRunState> {
  return { ...runs, [goalId]: run };
}
