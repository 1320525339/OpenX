import { describe, expect, it } from "vitest";
import type { Goal } from "@openx/shared";
import {
  countPinDeskFilter,
  matchesPinDeskSearch,
  sortPinDeskGoals,
} from "./task-desk-pin.js";

function goal(partial: Partial<Goal> & Pick<Goal, "id" | "status">): Goal {
  return {
    id: partial.id,
    orderNo: partial.orderNo ?? 1,
    conversationId: partial.conversationId ?? "c1",
    title: partial.title ?? "任务",
    acceptance: "",
    executionPrompt: "",
    constraints: [],
    executorId: "pi",
    status: partial.status,
    progress: partial.progress ?? 0,
    dependsOn: [],
    priority: "medium",
    createdAt: partial.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: partial.updatedAt ?? "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("task-desk-pin", () => {
  it("counts pin desk filters", () => {
    const goals = [
      goal({ id: "a", status: "running" }),
      goal({ id: "b", status: "awaiting_review" }),
      goal({ id: "c", status: "done" }),
      goal({ id: "d", status: "failed" }),
    ];
    expect(countPinDeskFilter(goals, "running")).toBe(1);
    expect(countPinDeskFilter(goals, "awaiting_review")).toBe(1);
    expect(countPinDeskFilter(goals, "done")).toBe(1);
    expect(countPinDeskFilter(goals, "failed")).toBe(1);
  });

  it("matches WO search", () => {
    const g = goal({ id: "x", status: "draft", orderNo: 44, title: "清理会话" });
    expect(matchesPinDeskSearch(g, "wo-000044")).toBe(true);
    expect(matchesPinDeskSearch(g, "清理")).toBe(true);
    expect(matchesPinDeskSearch(g, "nope")).toBe(false);
  });

  it("sorts by order number descending", () => {
    const goals = [
      goal({ id: "a", status: "draft", orderNo: 10 }),
      goal({ id: "b", status: "draft", orderNo: 44 }),
    ];
    const sorted = sortPinDeskGoals(goals, "orderNo");
    expect(sorted.map((g) => g.id)).toEqual(["b", "a"]);
  });
});
