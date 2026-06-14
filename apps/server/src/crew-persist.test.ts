import { beforeEach, describe, expect, it } from "vitest";
import {
  resetDb,
  insertGoal,
  listCrewExchanges,
  listCoachMessages,
  insertProject,
  insertConversation,
} from "./db.js";
import {
  persistCrewQuestion,
  persistForemanDirective,
  persistForemanEscalation,
} from "./crew-persist.js";
import type { Goal } from "@openx/shared";

function seedGoal(): Goal {
  const now = new Date().toISOString();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const projectId = `p-crew-${suffix}`;
  const conversationId = `conv-crew-${suffix}`;
  insertProject({
    id: projectId,
    name: "crew-test",
    workspaceDir: process.cwd(),
    createdAt: now,
  });
  insertConversation({
    id: conversationId,
    projectId,
    title: "对话",
    createdAt: now,
    updatedAt: now,
  });
  const goal: Goal = {
    id: `g-crew-${suffix}`,
    conversationId,
    title: "测试",
    acceptance: "ok",
    executionPrompt: "do",
    constraints: [],
    executorId: "pi",
    status: "running",
    progress: 10,
    foremanThreadId: conversationId,
    createdAt: now,
    updatedAt: now,
  };
  insertGoal(goal);
  return goal;
}

describe("crew-persist", () => {
  beforeEach(() => {
    resetDb();
  });

  it("persists question and directive with payload to crew_messages and coach thread", () => {
    const goal = seedGoal();
    const question = {
      kind: "question" as const,
      prompt: "选 A 还是 B",
      options: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
    };
    persistCrewQuestion(goal.id, question);
    persistForemanDirective(goal.id, {
      kind: "directive",
      message: "选 B",
      selectedOptionId: "b",
      source: "foreman_auto",
    });

    const crew = listCrewExchanges(goal.id);
    expect(crew).toHaveLength(2);
    expect(crew[0]).toMatchObject({
      direction: "crew_to_foreman",
      summary: "选 A 还是 B",
      goalId: goal.id,
      conversationId: goal.conversationId,
    });
    expect(crew[0]?.payload).toMatchObject(question);
    expect(crew[1]).toMatchObject({
      direction: "foreman_to_crew",
      summary: "选 B",
    });
    expect(crew[1]?.payload).toMatchObject({
      selectedOptionId: "b",
      source: "foreman_auto",
    });

    const coach = listCoachMessages(goal.conversationId);
    const texts = coach
      .filter((m) => m.kind === "text")
      .map((m) => (m.kind === "text" ? m.text : ""));
    expect(texts.some((t) => t.includes("施工队 → 工头"))).toBe(true);
    expect(texts.some((t) => t.includes("工头 → 施工队"))).toBe(true);
  });

  it("persists escalation with foreman_escalation direction", () => {
    const goal = seedGoal();
    persistForemanEscalation(goal.id, {
      kind: "escalation",
      prompt: "是否允许删库？",
      reason: "高风险",
    });
    const crew = listCrewExchanges(goal.id);
    expect(crew).toHaveLength(1);
    expect(crew[0]?.direction).toBe("foreman_escalation");
    expect(crew[0]?.payload).toMatchObject({ reason: "高风险" });
  });
});
