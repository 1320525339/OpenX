import { describe, expect, it } from "vitest";
import {
  applyRunDelta,
  applyRunStreamEvent,
  createEmptyRunState,
} from "./run.js";

const ts = "2026-06-08T00:00:00.000Z";

describe("applyRunStreamEvent", () => {
  it("starts a run and clears liveText", () => {
    const base = { ...createEmptyRunState("g1"), liveText: "old" };
    const next = applyRunStreamEvent(base, {
      type: "run.start",
      runId: "r1",
      executorId: "pi",
      timestamp: ts,
    });
    expect(next.active).toBe(true);
    expect(next.runId).toBe("r1");
    expect(next.executorId).toBe("pi");
    expect(next.liveText).toBe("");
  });

  it("appends text deltas", () => {
    let state = createEmptyRunState("g1");
    state = applyRunStreamEvent(state, {
      type: "run.start",
      runId: "r1",
      executorId: "pi",
      timestamp: ts,
    });
    state = applyRunStreamEvent(state, {
      type: "text.delta",
      delta: "hello ",
      timestamp: ts,
    });
    state = applyRunStreamEvent(state, {
      type: "text.delta",
      delta: "world",
      timestamp: ts,
    });
    expect(state.liveText).toBe("hello world");
  });

  it("ends run and keeps accumulated text", () => {
    let state = createEmptyRunState("g1");
    state = applyRunStreamEvent(state, {
      type: "run.start",
      runId: "r1",
      executorId: "pi",
      timestamp: ts,
    });
    state = applyRunStreamEvent(state, {
      type: "text.delta",
      delta: "done",
      timestamp: ts,
    });
    state = applyRunStreamEvent(state, {
      type: "run.end",
      status: "completed",
      timestamp: ts,
    });
    expect(state.active).toBe(false);
    expect(state.liveText).toBe("done");
  });
});

describe("applyRunDelta", () => {
  it("applies tool events via delta helper", () => {
    let state = createEmptyRunState("g1");
    state = applyRunStreamEvent(state, {
      type: "run.start",
      runId: "r1",
      executorId: "pi",
      timestamp: ts,
    });
    state = applyRunDelta(state, {
      type: "tool.start",
      tool: "read_file",
      timestamp: ts,
    });
    expect(state.events.some((e) => e.type === "tool.start")).toBe(true);
  });
});
