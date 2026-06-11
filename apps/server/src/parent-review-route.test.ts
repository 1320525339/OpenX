import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Goal } from "@openx/shared";
import { getGoalById, insertGoal, resetDb } from "./db.js";
import {
  seedTestProjectAndConversation,
  TEST_CONVERSATION_ID,
} from "./test-helpers.js";
import { routeParentReviewFail } from "./sub-goals.js";

function makeGoal(overrides: Partial<Goal> & Pick<Goal, "id" | "title">): Goal {
  const now = new Date().toISOString();
  return {
    conversationId: TEST_CONVERSATION_ID,
    acceptance: overrides.acceptance ?? "集成验收",
    executionPrompt: overrides.executionPrompt ?? "执行",
    constraints: overrides.constraints ?? [],
    executorId: overrides.executorId ?? "pi",
    status: overrides.status ?? "awaiting_review",
    progress: overrides.progress ?? 100,
    dependsOn: overrides.dependsOn ?? [],
    priority: overrides.priority ?? "medium",
    autoReview: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("routeParentReviewFail", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
    seedTestProjectAndConversation();
  });

  afterEach(() => {
    resetDb();
    delete process.env.OPENX_DB_PATH;
  });

  it("reopens matched done child instead of spawning generic fix goal", async () => {
    const parent = makeGoal({ id: "parent", title: "全栈功能", status: "awaiting_review" });
    const child = makeGoal({
      id: "child-api",
      title: "API 层",
      status: "done",
      effectStatus: "approved",
      parentGoalId: "parent",
      resultSummary: "已实现",
    });
    insertGoal(parent);
    insertGoal(child);

    const reopened = await routeParentReviewFail(parent.id, {
      verdict: "fail",
      reason: "API 与前端字段不一致",
      reworkTargets: [
        { childTitle: "API 层", instruction: "统一响应字段为 userId" },
      ],
    });

    expect(reopened).toHaveLength(1);
    expect(reopened[0]?.id).toBe("child-api");
    expect(getGoalById("child-api")?.status).toBe("running");
    expect(getGoalById("child-api")?.effectStatus).toBe("rework");
    expect(getGoalById("child-api")?.reworkReason).toContain("userId");
    expect(getGoalById("parent")?.status).toBe("draft");
  });
});
