import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Goal } from "@openx/shared";
import { getGoalById, insertGoal, resetDb } from "./db.js";
import {
  seedTestProjectAndConversation,
  TEST_CONVERSATION_ID,
} from "./test-helpers.js";
import { approveGoal } from "./goal-actions.js";
import {
  buildParentRollupSummary,
  rollUpParentGoalForTest,
} from "./parent-goal-rollup.js";

const synthesizeParentRollupSummaryMock = vi.fn(async () => ({ summary: null }));

vi.mock("@openx/coach", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openx/coach")>();
  return {
    ...actual,
    synthesizeParentRollupSummary: (...args: unknown[]) =>
      synthesizeParentRollupSummaryMock(...args),
  };
});

function makeGoal(overrides: Partial<Goal> & Pick<Goal, "id" | "title">): Goal {
  const now = new Date().toISOString();
  return {
    conversationId: TEST_CONVERSATION_ID,
    acceptance: overrides.acceptance ?? "验收通过",
    executionPrompt: overrides.executionPrompt ?? "执行",
    constraints: overrides.constraints ?? [],
    executorId: overrides.executorId ?? "pi",
    status: overrides.status ?? "draft",
    progress: overrides.progress ?? 0,
    dependsOn: overrides.dependsOn ?? [],
    priority: overrides.priority ?? "medium",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("parent-goal-rollup", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
    seedTestProjectAndConversation();
    synthesizeParentRollupSummaryMock.mockClear();
  });

  afterEach(() => {
    resetDb();
    delete process.env.OPENX_DB_PATH;
  });

  it("buildParentRollupSummary aggregates child result summaries", () => {
    const parent = makeGoal({ id: "p1", title: "核心功能" });
    const children = [
      makeGoal({
        id: "c1",
        title: "API",
        status: "done",
        resultSummary: "已实现 POST /login",
      }),
      makeGoal({
        id: "c2",
        title: "前端",
        status: "done",
        resultSummary: "登录页已提交",
      }),
    ];
    const summary = buildParentRollupSummary(parent, children);
    expect(summary).toContain("2 项子任务已全部完成");
    expect(summary).toContain("POST /login");
    expect(summary).toContain("登录页已提交");
  });

  it("rolls parent to awaiting_review when all children are done", async () => {
    const parent = makeGoal({
      id: "parent",
      title: "North Star",
      status: "draft",
      autoReview: false,
    });
    const childA = makeGoal({
      id: "child-a",
      title: "子任务 A",
      status: "done",
      parentGoalId: "parent",
      resultSummary: "A 完成",
      effectStatus: "approved",
    });
    const childB = makeGoal({
      id: "child-b",
      title: "子任务 B",
      status: "awaiting_review",
      parentGoalId: "parent",
      resultSummary: "B 待确认",
    });
    insertGoal(parent);
    insertGoal(childA);
    insertGoal(childB);

    const beforeRevision = getGoalById("parent")?.revision ?? 0;
    approveGoal("child-b");
    await vi.waitFor(() => {
      const updatedParent = getGoalById("parent");
      expect(updatedParent?.status).toBe("awaiting_review");
      expect(updatedParent?.progress).toBe(100);
      expect(updatedParent?.resultSummary).toContain("A 完成");
      expect(updatedParent?.resultSummary).toContain("B 待确认");
      expect((updatedParent?.revision ?? 0) > beforeRevision).toBe(true);
    });
  });

  it("does not roll up while a sibling is still running", async () => {
    const parent = makeGoal({ id: "parent", title: "父", status: "draft" });
    const doneChild = makeGoal({
      id: "done-child",
      title: "已完成",
      status: "done",
      parentGoalId: "parent",
      effectStatus: "approved",
    });
    const runningChild = makeGoal({
      id: "running-child",
      title: "进行中",
      status: "running",
      parentGoalId: "parent",
      progress: 40,
    });
    insertGoal(parent);
    insertGoal(doneChild);
    insertGoal(runningChild);

    await rollUpParentGoalForTest("done-child");

    expect(getGoalById("parent")?.status).toBe("draft");
  });

  it("approveGoal triggers parent rollup when last child is approved", async () => {
    const parent = makeGoal({ id: "parent", title: "父", status: "draft" });
    const childA = makeGoal({
      id: "child-a",
      title: "A",
      status: "done",
      parentGoalId: "parent",
      effectStatus: "approved",
      resultSummary: "A ok",
    });
    const childB = makeGoal({
      id: "child-b",
      title: "B",
      status: "awaiting_review",
      parentGoalId: "parent",
      resultSummary: "B ok",
    });
    insertGoal(parent);
    insertGoal(childA);
    insertGoal(childB);

    const result = approveGoal("child-b");
    expect(result.ok).toBe(true);
    await vi.waitFor(() => {
      expect(getGoalById("parent")?.status).toBe("awaiting_review");
    });
  });
});
