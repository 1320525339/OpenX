import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { resetDb, insertGoal, getGoalById, deleteGoals } from "./db.js";
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

  afterEach(() => {
    resetDb();
    resetConnections();
  });

  it("marks running goal failed", () => {
    const goal = makeGoal({ status: "running" });
    insertGoal(goal);
    const result = markGoalFailed(goal.id, "boom");
    expect(result.ok).toBe(true);
    expect(getGoalById(goal.id)?.status).toBe("failed");
  });

  it("deleteGoals clears cancelledGoalIds when purging a goal", () => {
    const goal = makeGoal({ status: "cancelled" });
    insertGoal(goal);

    // 模拟目标被取消后打上标记
    markGoalCancelledForConnect(goal.id);
    expect(isGoalCancelledForConnect(goal.id)).toBe(true);

    // 删除目标后，取消标记应被清理
    const result = deleteGoals([goal.id]);
    expect(result.deleted).toContain(goal.id);
    expect(isGoalCancelledForConnect(goal.id)).toBe(false);
  });
});
