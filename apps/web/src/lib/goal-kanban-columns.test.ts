import { describe, expect, it } from "vitest";
import type { Goal } from "@openx/shared";
import { buildKanbanColumns } from "./goal-kanban-columns.js";

function makeGoal(overrides: Partial<Goal> & Pick<Goal, "id" | "title" | "status">): Goal {
  const now = new Date().toISOString();
  return {
    orderNo: 1,
    conversationId: "c1",
    acceptance: "ok",
    executionPrompt: "run",
    constraints: [],
    executorId: "pi",
    progress: 0,
    dependsOn: [],
    priority: "medium",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("buildKanbanColumns", () => {
  it("partitions goals into four columns", () => {
    const cols = buildKanbanColumns([
      makeGoal({ id: "a", title: "A", status: "draft" }),
      makeGoal({ id: "b", title: "B", status: "awaiting_review" }),
      makeGoal({ id: "c", title: "C", status: "done" }),
      makeGoal({ id: "d", title: "D", status: "failed" }),
    ]);
    expect(cols.map((c) => c.key)).toEqual(["incomplete", "review", "done", "failed"]);
    expect(cols[0]?.goals.map((g) => g.id)).toEqual(["a"]);
    expect(cols[1]?.goals.map((g) => g.id)).toEqual(["b"]);
    expect(cols[2]?.goals.map((g) => g.id)).toEqual(["c"]);
    expect(cols[3]?.goals.map((g) => g.id)).toEqual(["d"]);
  });

  it("sorts by orderNo then createdAt", () => {
    const cols = buildKanbanColumns([
      makeGoal({ id: "x", title: "X", status: "draft", orderNo: 5, createdAt: "2026-01-02T00:00:00.000Z" }),
      makeGoal({ id: "y", title: "Y", status: "draft", orderNo: 2, createdAt: "2026-01-03T00:00:00.000Z" }),
    ]);
    expect(cols[0]?.goals.map((g) => g.id)).toEqual(["y", "x"]);
  });
});
