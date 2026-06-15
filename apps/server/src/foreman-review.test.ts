import { beforeEach, describe, expect, it } from "vitest";
import {
  resetDb,
  insertGoal,
  insertProject,
  insertConversation,
  listCrewExchanges,
  listCoachMessages,
} from "./db.js";
import { recordForemanReviewVerdict } from "./foreman-review.js";
import type { Goal } from "@openx/shared";

function seedGoal(): Goal {
  const now = new Date().toISOString();
  insertProject({
    id: "p-review",
    name: "review-test",
    workspaceDir: process.cwd(),
    createdAt: now,
  });
  insertConversation({
    id: "conv-review",
    projectId: "p-review",
    title: "对话",
    createdAt: now,
    updatedAt: now,
  });
  const goal: Goal = {
    id: "g-review",
    orderNo: 1,
    conversationId: "conv-review",
    title: "验收目标",
    acceptance: "ok",
    executionPrompt: "do",
    constraints: [],
    executorId: "pi",
    status: "awaiting_review",
    progress: 100,
    foremanThreadId: "conv-review",
    createdAt: now,
    updatedAt: now,
  };
  insertGoal(goal);
  return goal;
}

describe("foreman-review", () => {
  beforeEach(() => {
    resetDb();
  });

  it("records pass verdict into crew_messages and coach thread", () => {
    const goal = seedGoal();
    recordForemanReviewVerdict(
      goal.id,
      { verdict: "pass", reason: "测试全部通过" },
      { iteration: 2, verifySummary: "npm test ok" },
    );

    const crew = listCrewExchanges(goal.id);
    expect(crew).toHaveLength(1);
    expect(crew[0]?.direction).toBe("foreman_review");
    expect(crew[0]?.summary).toContain("工头验收通过");
    expect(crew[0]?.summary).toContain("第 2 轮");
    expect(crew[0]?.payload).toMatchObject({
      iteration: 2,
      verifySummary: "npm test ok",
    });

    const coach = listCoachMessages(goal.conversationId);
    expect(
      coach.some(
        (m) => m.kind === "text" && m.text.includes("工头验收") && m.text.includes("通过"),
      ),
    ).toBe(true);
  });

  it("no-ops when goal is missing", () => {
    recordForemanReviewVerdict("missing-goal", {
      verdict: "pass",
      reason: "不应写入",
    });
    expect(listCrewExchanges("missing-goal")).toHaveLength(0);
  });
});
