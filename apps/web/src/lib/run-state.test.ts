import { describe, expect, it } from "vitest";
import { createEmptyRunState } from "@openx/shared";
import { reconcileRunState } from "./run-state";

describe("reconcileRunState", () => {
  it("keeps richer local state during SSE gap", () => {
    const existing = {
      ...createEmptyRunState("g1"),
      active: true,
      liveText: "hello world",
      events: [
        { type: "text.delta" as const, delta: "hello world", timestamp: "t1" },
      ],
    };
    const fetched = {
      ...createEmptyRunState("g1"),
      active: true,
      liveText: "hello",
      events: [{ type: "text.delta" as const, delta: "hello", timestamp: "t1" }],
    };
    const merged = reconcileRunState(existing, fetched);
    expect(merged.liveText).toBe("hello world");
    expect(merged.active).toBe(true);
  });

  it("prefers remote when it has more data", () => {
    const existing = createEmptyRunState("g1");
    const fetched = {
      ...createEmptyRunState("g1"),
      liveText: "remote wins",
      events: [
        { type: "text.delta" as const, delta: "remote wins", timestamp: "t2" },
      ],
    };
    expect(reconcileRunState(existing, fetched).liveText).toBe("remote wins");
  });
});
