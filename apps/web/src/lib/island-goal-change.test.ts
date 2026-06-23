import { describe, expect, it } from "vitest";
import type { Goal } from "@openx/shared";
import { islandFromGoalChange } from "./island-payload";

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "g1",
    conversationId: "c1",
    title: "清理当前项目所有会话",
    acceptance: "完成",
    status: "running",
    progress: 50,
    iterationCount: 0,
    maxIterations: 20,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("islandFromGoalChange", () => {
  it("does not re-notify when awaiting_review patches repeat", () => {
    const awaiting = goal({ status: "awaiting_review", progress: 100 });
    expect(islandFromGoalChange(awaiting, { ...awaiting, updatedAt: "2026-01-02T00:00:00.000Z" })).toBeNull();
    expect(
      islandFromGoalChange(awaiting, {
        ...awaiting,
        resultSummary: "已清理 3 个会话",
      }),
    ).toBeNull();
  });

  it("notifies once when running becomes awaiting_review", () => {
    const running = goal({ status: "running" });
    const awaiting = goal({ status: "awaiting_review", progress: 100 });
    const island = islandFromGoalChange(running, awaiting);
    expect(island?.kind).toBe("goal.awaiting_review");
    expect(island?.title).toBe("清理当前项目所有会话");
  });
});
