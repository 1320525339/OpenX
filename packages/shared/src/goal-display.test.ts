import { describe, expect, it } from "vitest";
import type { Goal } from "./goal.js";
import { goalDisplayHint, goalMatchesDisplayFilter } from "./goal-display.js";

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
  dependsOn: [],
  priority: "medium",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("goalDisplayHint", () => {
  it("shows awaiting hint for paused goals", () => {
    const goal = { ...base, status: "paused" as const, crewStatus: "awaiting_user" as const };
    expect(goalDisplayHint(goal)).toBe("等待开发商决策");
  });
});

describe("goalMatchesDisplayFilter", () => {
  it("matches awaiting_user and paused filters for paused goals", () => {
    const goal = { ...base, status: "paused" as const, crewStatus: "awaiting_user" as const };
    expect(goalMatchesDisplayFilter(goal, "awaiting_user")).toBe(true);
    expect(goalMatchesDisplayFilter(goal, "paused")).toBe(true);
    expect(goalMatchesDisplayFilter(goal, "running")).toBe(false);
  });

  it("excludes idle running goals from awaiting_user filter", () => {
    const goal = { ...base, crewStatus: "idle" as const };
    expect(goalMatchesDisplayFilter(goal, "awaiting_user")).toBe(false);
  });
});
