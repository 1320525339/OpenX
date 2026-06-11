import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  emitGoalRunEvent,
  flushMergeBuffer,
  resetRunService,
  startGoalRun,
} from "./run-service.js";

const appendMock = vi.fn();
const broadcastMock = vi.fn();

vi.mock("./db.js", () => ({
  appendRunEventRecord: (...args: unknown[]) => appendMock(...args),
  clearRunEvents: vi.fn(),
  listRunEventRecords: vi.fn(() => []),
}));

vi.mock("./sse.js", () => ({
  broadcast: (...args: unknown[]) => broadcastMock(...args),
}));

describe("run-service merge buffer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    appendMock.mockClear();
    broadcastMock.mockClear();
    resetRunService();
  });

  afterEach(() => {
    resetRunService();
    vi.useRealTimers();
  });

  it("merges text.delta DB writes within 200ms while broadcasting live", () => {
    startGoalRun("goal-1", "pi");
    emitGoalRunEvent("goal-1", {
      type: "text.delta",
      delta: "hello ",
      timestamp: new Date().toISOString(),
    });
    emitGoalRunEvent("goal-1", {
      type: "text.delta",
      delta: "world",
      timestamp: new Date().toISOString(),
    });

    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(broadcastMock).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(200);
    expect(appendMock).toHaveBeenCalledTimes(2);
    const event = appendMock.mock.calls[1]![2] as { type: string; delta: string };
    expect(event.type).toBe("text.delta");
    expect(event.delta).toBe("hello world");
  });

  it("flushes buffer before non-delta events", () => {
    startGoalRun("goal-1", "pi");
    emitGoalRunEvent("goal-1", {
      type: "text.delta",
      delta: "partial",
      timestamp: new Date().toISOString(),
    });
    emitGoalRunEvent("goal-1", {
      type: "status",
      message: "done",
      timestamp: new Date().toISOString(),
    });

    expect(appendMock).toHaveBeenCalledTimes(3);
    expect(appendMock.mock.calls[1]![2]).toMatchObject({
      type: "text.delta",
      delta: "partial",
    });
    expect(appendMock.mock.calls[2]![2]).toMatchObject({
      type: "status",
      message: "done",
    });
  });

  it("flushMergeBuffer writes pending deltas immediately", () => {
    startGoalRun("goal-1", "pi");
    emitGoalRunEvent("goal-1", {
      type: "thinking.delta",
      delta: "think",
      timestamp: new Date().toISOString(),
    });
    flushMergeBuffer("goal-1");
    expect(appendMock).toHaveBeenCalledTimes(2);
    expect(appendMock.mock.calls[1]![2]).toMatchObject({
      type: "thinking.delta",
      delta: "think",
    });
  });
});
