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

  it("ends run as paused without clearing live text", () => {
    let state = createEmptyRunState("g1");
    state = applyRunStreamEvent(state, {
      type: "run.start",
      runId: "r1",
      executorId: "pi",
      timestamp: ts,
    });
    state = applyRunStreamEvent(state, {
      type: "run.end",
      status: "paused",
      summary: "等待开发商",
      timestamp: ts,
    });
    expect(state.active).toBe(false);
  });

  it("accumulates thinking deltas", () => {
    let state = createEmptyRunState("g1");
    state = applyRunStreamEvent(state, {
      type: "run.start",
      runId: "r1",
      executorId: "pi",
      timestamp: ts,
    });
    state = applyRunStreamEvent(state, {
      type: "thinking.delta",
      delta: "let me ",
      timestamp: ts,
    });
    state = applyRunStreamEvent(state, {
      type: "thinking.delta",
      delta: "think",
      timestamp: ts,
    });
    expect(state.thinkingText).toBe("let me think");
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

  it("applies tool.update with toolCallId", () => {
    let state = createEmptyRunState("g1");
    state = applyRunDelta(state, {
      type: "tool.start",
      tool: "read",
      toolCallId: "tc-1",
      timestamp: ts,
    });
    state = applyRunDelta(state, {
      type: "tool.update",
      tool: "read",
      toolCallId: "tc-1",
      outputPreview: "partial output",
      timestamp: ts,
    });
    const update = state.events.find((e) => e.type === "tool.update");
    expect(update && "outputPreview" in update && update.outputPreview).toBe("partial output");
  });

  it("preserves fileDiff on tool.end", () => {
    let state = createEmptyRunState("g1");
    state = applyRunDelta(state, {
      type: "tool.end",
      tool: "edit_file",
      toolCallId: "tc-2",
      fileDiff: { diff: "-a\n+b", added: 1, removed: 1, path: "x.ts" },
      timestamp: ts,
    });
    const end = state.events.find((e) => e.type === "tool.end");
    expect(end && "fileDiff" in end && end.fileDiff?.path).toBe("x.ts");
  });
});
