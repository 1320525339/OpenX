import { describe, expect, it } from "vitest";
import { RunEventEmitter } from "./run-events.js";

describe("RunEventEmitter", () => {
  it("buffers and flushes thinking deltas", async () => {
    const events: Array<{ type: string; delta?: string }> = [];
    const run = new RunEventEmitter(async (event) => {
      events.push(event);
    });
    await run.thinkingDelta("a".repeat(70));
    await run.finish();
    expect(events.some((e) => e.type === "thinking.delta")).toBe(true);
  });

  it("throttles tool.update by toolCallId", async () => {
    const events: Array<{ type: string }> = [];
    const run = new RunEventEmitter(async (event) => {
      events.push(event);
    });
    await run.toolUpdate("read", "tc-1", "out-1");
    await run.toolUpdate("read", "tc-1", "out-2");
    expect(events.filter((e) => e.type === "tool.update")).toHaveLength(1);
  });
});
