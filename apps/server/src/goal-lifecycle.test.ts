import { beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { resetDb, insertGoal, getGoalById } from "./db.js";
import {
  cancelGoalStatus,
  markGoalComplete,
  markGoalFailed,
  updateGoalProgress,
} from "./goal-lifecycle.js";
import type { Goal } from "@openx/shared";
import {
  seedTestProjectAndConversation,
  TEST_CONVERSATION_ID,
} from "./test-helpers.js";

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  const now = new Date().toISOString();
  return {
    id: nanoid(),
    conversationId: TEST_CONVERSATION_ID,
    title: "测试目标",
    acceptance: "通过",
    executionPrompt: "执行",
    constraints: [],
    executorId: "pi",
    status: "running",
    progress: 10,
    dependsOn: [],
    priority: "medium",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("goal-lifecycle", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
    seedTestProjectAndConversation();
  });

  it("rejects illegal complete transition", () => {
    const goal = makeGoal({ status: "done" });
    insertGoal(goal);
    const result = markGoalComplete(goal.id, "ok");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it("completes running goal", () => {
    const goal = makeGoal({ status: "running" });
    insertGoal(goal);
    const result = markGoalComplete(goal.id, "完成");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.goal.status).toBe("awaiting_review");
      expect(result.goal.resultSummary).toBe("完成");
    }
  });

  it("persists structured deliverables on complete", () => {
    const goal = makeGoal({ status: "running" });
    insertGoal(goal);
    const deliverables = [
      { kind: "file" as const, path: "src/a.ts", label: "a.ts", action: "modified" as const },
    ];
    const result = markGoalComplete(goal.id, "完成", deliverables);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.goal.deliverables).toEqual(deliverables);
      expect(getGoalById(goal.id)?.deliverables).toEqual(deliverables);
    }
  });

  it("rejects cancel from done", () => {
    const goal = makeGoal({ status: "done" });
    insertGoal(goal);
    const result = cancelGoalStatus(goal.id);
    expect(result.ok).toBe(false);
  });

  it("updates progress only when running", () => {
    const goal = makeGoal({ status: "draft" });
    insertGoal(goal);
    const result = updateGoalProgress(goal.id, 50);
    expect(result.ok).toBe(false);
  });

  it("marks running goal failed", () => {
    const goal = makeGoal({ status: "running" });
    insertGoal(goal);
    const result = markGoalFailed(goal.id, "boom");
    expect(result.ok).toBe(true);
    expect(getGoalById(goal.id)?.status).toBe("failed");
  });
});
