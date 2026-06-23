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
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("goalDisplayHint", () => {
  it("shows awaiting_user hint for parked crew", () => {
    const goal = { ...base, crewStatus: "awaiting_user" as const };
    expect(goalDisplayHint(goal)).toBe("等待开发商决策");
  });
});

describe("goalMatchesDisplayFilter", () => {
  it("matches awaiting_user filter for running goals waiting on user", () => {
    const goal = { ...base, crewStatus: "awaiting_user" as const };
    expect(goalMatchesDisplayFilter(goal, "awaiting_user")).toBe(true);
    expect(goalMatchesDisplayFilter(goal, "running")).toBe(true);
  });

  it("excludes idle running goals from awaiting_user filter", () => {
    const goal = { ...base, crewStatus: "idle" as const };
    expect(goalMatchesDisplayFilter(goal, "awaiting_user")).toBe(false);
  });
});
