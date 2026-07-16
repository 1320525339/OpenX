import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import {
  resetDb,
  insertGoal,
  getGoalById,
  deleteGoals,
  casUpdateGoal,
  GoalRevisionConflictError,
} from "./db.js";
import {
  cancelGoalStatus,
  markGoalComplete,
  markGoalFailed,
  updateGoalProgress,
} from "./goal-lifecycle.js";
import type { Goal } from "@openx/shared";
import {
  markGoalCancelledForConnect,
  isGoalCancelledForConnect,
  resetConnections,
} from "./connect-store.js";
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
    orderNo: 1,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("goal-lifecycle", () => {
  beforeEach(() => {
    resetDb();
    resetConnections();
    seedTestProjectAndConversation();
  });
  afterEach(() => {
    resetDb();
    resetConnections();
  });

  it("rejects illegal complete transition", () => {
    const goal = makeGoal({ status: "draft" });
    insertGoal(goal);
    const result = markGoalComplete(goal.id, "ok");
    expect(result.ok).toBe(false);
  });

  it("completes running goal", () => {
    const goal = makeGoal({ status: "running" });
    insertGoal(goal);
    const result = markGoalComplete(goal.id, "完成");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.goal.status).toBe("awaiting_review");
      expect(result.goal.resultSummary).toBe("完成");
      expect(result.goal.revision).toBe(1);
    }
  });

  it("persists structured deliverables", () => {
    const goal = makeGoal({ status: "running" });
    insertGoal(goal);
    const deliverables = [
      { kind: "file" as const, path: "hello.txt", action: "created" as const },
    ];
    const result = markGoalComplete(goal.id, "完成", deliverables);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.goal.deliverables).toEqual(deliverables);
      expect(getGoalById(goal.id)?.deliverables).toEqual(deliverables);
    }
  });

  it("rejects empty completion without deliverables", () => {
    const goal = makeGoal({ status: "running" });
    insertGoal(goal);
    const result = markGoalComplete(goal.id, "  ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
    expect(getGoalById(goal.id)?.status).toBe("failed");
  });

  it("rejects executor completion that says the task is incomplete", () => {
    const goal = makeGoal({ status: "running" });
    insertGoal(goal);
    const result = markGoalComplete(
      goal.id,
      "Pi 工具调用达到上限（20 次），任务未完成。摘要：仍缺少验证。",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
    expect(getGoalById(goal.id)?.status).toBe("failed");
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

  it("marks failed from running", () => {
    const goal = makeGoal({ status: "running" });
    insertGoal(goal);
    const result = markGoalFailed(goal.id, "boom");
    expect(result.ok).toBe(true);
    expect(getGoalById(goal.id)?.status).toBe("failed");
  });

  it("CAS rejects stale revision on complete vs cancel race", () => {
    const goal = makeGoal({ status: "running", revision: 0 });
    insertGoal(goal);
    const cancelled = cancelGoalStatus(goal.id);
    expect(cancelled.ok).toBe(true);
    // stale in-memory complete attempt after cancel bumped revision
    const stale = { ...goal, status: "awaiting_review" as const, progress: 100 };
    expect(() => casUpdateGoal(stale, { expectedStatuses: ["running"] })).toThrow(
      GoalRevisionConflictError,
    );
    expect(getGoalById(goal.id)?.status).toBe("cancelled");
  });

  it("connect cancel flag helpers", () => {
    const goal = makeGoal();
    insertGoal(goal);
    markGoalCancelledForConnect(goal.id);
    expect(isGoalCancelledForConnect(goal.id)).toBe(true);
    deleteGoals([goal.id]);
  });
});
