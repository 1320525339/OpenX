import { beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import type { Goal } from "@openx/shared";
import {
  resetDb,
  insertGoal,
  saveCoachClarifyMessage,
  saveCoachMessage,
} from "./db.js";
import { approveGoal, waiveChildGoal } from "./goal-actions.js";
import { markGoalComplete } from "./goal-lifecycle.js";
import { checkGoalApprovalGate } from "./goal-completion-gate.js";
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
    status: "awaiting_review",
    progress: 100,
    resultSummary: "完成",
    dependsOn: [],
    priority: "medium",
    autoReview: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("goal-completion-gate", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
    seedTestProjectAndConversation();
  });

  it("blocks manual approve until review pass when autoReview is enabled", () => {
    const goal = makeGoal({ autoReview: true });
    insertGoal(goal);
    const gate = checkGoalApprovalGate(goal.id, { source: "user" });
    expect(gate.ok).toBe(false);

    const approved = approveGoal(goal.id, { source: "user" });
    expect(approved.ok).toBe(false);
  });

  it("blocks parent markGoalComplete when child is still running", () => {
    const parent = makeGoal({
      id: "parent",
      status: "running",
      progress: 50,
      autoReview: false,
    });
    const child = makeGoal({
      id: "child",
      title: "子任务",
      status: "running",
      parentGoalId: "parent",
      progress: 20,
    });
    insertGoal(parent);
    insertGoal(child);

    const result = markGoalComplete(parent.id, "父摘要");
    expect(result.ok).toBe(false);
  });

  it("allows waived child to unblock parent gate", () => {
    const parent = makeGoal({
      id: "parent-2",
      status: "awaiting_review",
      autoReview: false,
    });
    const child = makeGoal({
      id: "child-2",
      title: "可豁免子任务",
      status: "running",
      parentGoalId: "parent-2",
      progress: 10,
    });
    insertGoal(parent);
    insertGoal(child);

    const waived = waiveChildGoal(child.id);
    expect(waived.ok).toBe(true);

    const gate = checkGoalApprovalGate(parent.id, { source: "user" });
    expect(gate.ok).toBe(true);
  });

  it("blocks approve when clarify is pending in conversation", () => {
    const goal = makeGoal({ autoReview: false });
    insertGoal(goal);
    saveCoachClarifyMessage(goal.conversationId, {
      title: "范围确认",
      questions: [{ id: "q1", prompt: "选 A 还是 B", options: [{ id: "a", label: "A" }] }],
      status: "pending",
    });

    const gate = checkGoalApprovalGate(goal.id, { source: "user" });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.reasons.some((r) => r.code === "pending_clarify")).toBe(true);
    }
  });
});
