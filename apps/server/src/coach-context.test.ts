import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { nanoid } from "nanoid";
import type { Goal } from "@openx/shared";
import { insertGoal, resetDb } from "./db.js";
import { buildCoachChatContext, resolveNorthStarGoal } from "./coach-context.js";
import {
  seedTestProjectAndConversation,
  TEST_CONVERSATION_ID,
} from "./test-helpers.js";

function makeGoal(overrides: Partial<Goal> & Pick<Goal, "title">): Goal {
  const now = new Date().toISOString();
  return {
    id: nanoid(),
    conversationId: TEST_CONVERSATION_ID,
    title: overrides.title,
    acceptance: overrides.acceptance ?? "验收通过",
    executionPrompt: overrides.executionPrompt ?? "执行",
    constraints: overrides.constraints ?? [],
    executorId: "pi",
    status: overrides.status ?? "draft",
    progress: overrides.progress ?? 0,
    userDraft: overrides.userDraft,
    resultSummary: overrides.resultSummary,
    effectStatus: overrides.effectStatus,
    reworkReason: overrides.reworkReason,
    parentGoalId: overrides.parentGoalId,
    dependsOn: overrides.dependsOn ?? [],
    priority: overrides.priority ?? "medium",
    createdAt: now,
    updatedAt: now,
  };
}

describe("coach-context", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
    seedTestProjectAndConversation();
  });

  afterEach(() => {
    resetDb();
    delete process.env.OPENX_DB_PATH;
  });

  it("resolveNorthStarGoal walks up to root parent", () => {
    const root = makeGoal({ title: "核心目标", status: "running" });
    insertGoal(root);
    const child = makeGoal({
      title: "子任务",
      parentGoalId: root.id,
      status: "running",
    });
    insertGoal(child);

    expect(resolveNorthStarGoal(child.id)?.id).toBe(root.id);
  });

  it("buildCoachChatContext includes north star and sub goals", () => {
    const root = makeGoal({
      title: "搭建登录",
      status: "running",
      acceptance: "可登录",
    });
    insertGoal(root);
    const sub = makeGoal({
      title: "写 API",
      parentGoalId: root.id,
      status: "awaiting_review",
      progress: 100,
      resultSummary: "POST /login OK",
    });
    insertGoal(sub);

    const ctx = buildCoachChatContext(TEST_CONVERSATION_ID, sub.id);
    expect(ctx.northStar?.title).toBe("搭建登录");
    expect(ctx.northStar?.acceptance).toBe("可登录");
    expect(ctx.subGoals?.some((g) => g.title === "写 API")).toBe(true);
    expect(ctx.selectedGoal?.title).toBe("写 API");
    expect(ctx.workspaceRoot).toBeTruthy();
  });

  it("always uses foreman agent regardless of legacy agentId opt", () => {
    const ctx = buildCoachChatContext(TEST_CONVERSATION_ID, undefined, {
      message: "你好",
    });
    expect(ctx.agentId).toBe("coach");
    expect(ctx.agentName).toContain("工头");
  });
});
