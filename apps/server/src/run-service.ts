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
import { persistCoachRunMessage } from "./coach-run-persist.js";

const activeByGoal = new Map<string, { runId: string; executorId: string }>();

const MERGE_WINDOW_MS = 200;

type MergeBuffer = {
  runId: string;
  textDelta: string;
  thinkingDelta: string;
  timer: ReturnType<typeof setTimeout> | null;
};

const mergeBuffers = new Map<string, MergeBuffer>();

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

function broadcastRunStream(goalId: string, runId: string, event: RunStreamEvent) {
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

function persistAndBroadcast(goalId: string, runId: string, event: RunStreamEvent) {
  appendRunEventRecord(goalId, runId, event);
  broadcastRunStream(goalId, runId, event);
}

function clearMergeBuffer(goalId: string) {
  const buf = mergeBuffers.get(goalId);
  if (buf?.timer) {
    clearTimeout(buf.timer);
  }
  mergeBuffers.delete(goalId);
}

function getMergeBuffer(goalId: string, runId: string): MergeBuffer {
  const existing = mergeBuffers.get(goalId);
  if (existing) return existing;
  const buf: MergeBuffer = {
    runId,
    textDelta: "",
    thinkingDelta: "",
    timer: null,
  };
  mergeBuffers.set(goalId, buf);
  return buf;
}

function scheduleMergeFlush(goalId: string) {
  const buf = mergeBuffers.get(goalId);
  if (!buf || buf.timer) return;
  buf.timer = setTimeout(() => {
    flushMergeBuffer(goalId);
  }, MERGE_WINDOW_MS);
  if (typeof buf.timer === "object" && "unref" in buf.timer) {
    buf.timer.unref();
  }
}

/** 将缓冲的 text/thinking delta 合并落库（SSE 已在接收时实时广播） */
export function flushMergeBuffer(goalId: string): void {
  const buf = mergeBuffers.get(goalId);
  if (!buf) return;
  if (buf.timer) {
    clearTimeout(buf.timer);
    buf.timer = null;
  }

  const active = activeByGoal.get(goalId);
  if (!active || active.runId !== buf.runId) {
    clearMergeBuffer(goalId);
    return;
  }

  const ts = new Date().toISOString();
  if (buf.textDelta) {
    const merged = buf.textDelta;
    buf.textDelta = "";
    appendRunEventRecord(goalId, active.runId, {
      type: "text.delta",
      delta: merged,
      timestamp: ts,
    });
  }
  if (buf.thinkingDelta) {
    const merged = buf.thinkingDelta;
    buf.thinkingDelta = "";
    appendRunEventRecord(goalId, active.runId, {
      type: "thinking.delta",
      delta: merged,
      timestamp: ts,
    });
  }

  if (!buf.textDelta && !buf.thinkingDelta) {
    mergeBuffers.delete(goalId);
  }
}

export function startGoalRun(goalId: string, executorId: string): string {
  flushMergeBuffer(goalId);
  clearMergeBuffer(goalId);
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

  if (event.type === "text.delta" || event.type === "thinking.delta") {
    const buf = getMergeBuffer(goalId, active.runId);
    if (event.type === "text.delta") {
      buf.textDelta += event.delta;
    } else {
      buf.thinkingDelta += event.delta;
    }
    broadcastRunStream(goalId, active.runId, event as RunStreamEvent);
    scheduleMergeFlush(goalId);
    return;
  }

  flushMergeBuffer(goalId);
  persistAndBroadcast(goalId, active.runId, event as RunStreamEvent);
}

export function endGoalRun(
  goalId: string,
  status: RunEndStatus,
  summary?: string,
): void {
  const active = activeByGoal.get(goalId);
  if (!active) return;
  flushMergeBuffer(goalId);
  clearMergeBuffer(goalId);
  const endEvent: RunStreamEvent = {
    type: "run.end",
    status,
    summary,
    timestamp: new Date().toISOString(),
  };
  const snapshot = applyRunStreamEvent(buildRunStateFromDb(goalId), endEvent);
  persistAndBroadcast(goalId, active.runId, endEvent);
  activeByGoal.delete(goalId);
  persistCoachRunMessage(goalId, snapshot);
}

/** 测试用 */
export function resetRunService(): void {
  for (const goalId of mergeBuffers.keys()) {
    clearMergeBuffer(goalId);
  }
  activeByGoal.clear();
}
