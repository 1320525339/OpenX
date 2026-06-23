import { describe, expect, it } from "vitest";
import type { Goal } from "./goal.js";
import { goalDisplayHint } from "./goal-display.js";

const base: Goal = {
  id: "g1",
  conversationId: "c1",
  executorId: "pi",
  title: "t",
  orderNo: 1,
  acceptance: "",
  executionPrompt: "",
  constraints: [],
  status: "running",
  progress: 50,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("goalDisplayHint", () => {
  it("shows awaiting_user hint for parked crew", () => {
    const goal = { ...base, crewStatus: "awaiting_user" as const };
    expect(goalDisplayHint(goal)).toBe("等待开发商决策");
  });
});
