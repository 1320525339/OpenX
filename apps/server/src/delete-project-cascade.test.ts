import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import type { Goal } from "@openx/shared";
import {
  resetDb,
  insertProject,
  insertConversation,
  insertGoal,
  getGoalById,
  getProjectById,
  getConversationById,
  listGoals,
  listConversations,
  deleteProject,
  saveCoachMessage,
  listCoachMessages,
  appendCrewExchange,
  listCrewExchanges,
} from "./db.js";

function makeGoal(
  conversationId: string,
  overrides: Partial<Goal> = {},
): Goal {
  const now = new Date().toISOString();
  return {
    id: nanoid(),
    conversationId,
    title: "任务",
    acceptance: "通过",
    executionPrompt: "执行",
    constraints: [],
    executorId: "pi",
    status: "draft",
    progress: 0,
    dependsOn: [],
    priority: "medium",
    orderNo: 1,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("deleteProject cascade", () => {
  beforeEach(() => {
    resetDb();
  });
  afterEach(() => {
    resetDb();
  });

  it("deletes project conversations, goals, coach messages and crew exchanges", () => {
    const now = new Date().toISOString();
    const projectId = nanoid();
    const convA = nanoid();
    const convB = nanoid();
    insertProject({
      id: projectId,
      name: "待删项目",
      workspaceDir: process.cwd(),
      createdAt: now,
    });
    insertConversation({
      id: convA,
      projectId,
      title: "对话 A",
      createdAt: now,
      updatedAt: now,
    });
    insertConversation({
      id: convB,
      projectId,
      title: "对话 B",
      createdAt: now,
      updatedAt: now,
    });

    const goalA = makeGoal(convA, { title: "A", orderNo: 1 });
    const goalB = makeGoal(convB, {
      title: "B",
      orderNo: 2,
      // 跨对话依赖：旧逻辑按对话逐个删除时会卡住
      dependsOn: [goalA.id],
    });
    insertGoal(goalA);
    insertGoal(goalB);
    saveCoachMessage(convA, "user", "你好");
    appendCrewExchange({
      goalId: goalA.id,
      conversationId: convA,
      direction: "foreman_to_crew",
      summary: "派单",
    });

    expect(deleteProject(projectId)).toBe(true);
    expect(getProjectById(projectId)).toBeUndefined();
    expect(getConversationById(convA)).toBeUndefined();
    expect(getConversationById(convB)).toBeUndefined();
    expect(getGoalById(goalA.id)).toBeUndefined();
    expect(getGoalById(goalB.id)).toBeUndefined();
    expect(listGoals({ projectId })).toHaveLength(0);
    expect(listConversations(projectId)).toHaveLength(0);
    expect(listCoachMessages(convA)).toHaveLength(0);
    expect(listCrewExchanges(goalA.id)).toHaveLength(0);
  });

  it("does not remove unrelated projects", () => {
    const now = new Date().toISOString();
    const keepId = nanoid();
    const dropId = nanoid();
    insertProject({
      id: keepId,
      name: "保留",
      workspaceDir: process.cwd(),
      createdAt: now,
    });
    insertProject({
      id: dropId,
      name: "删除",
      workspaceDir: process.cwd(),
      createdAt: now,
    });
    const keepConv = nanoid();
    insertConversation({
      id: keepConv,
      projectId: keepId,
      title: "保留对话",
      createdAt: now,
      updatedAt: now,
    });
    const keepGoal = makeGoal(keepConv, { title: "保留任务" });
    insertGoal(keepGoal);

    expect(deleteProject(dropId)).toBe(true);
    expect(getProjectById(keepId)).toBeDefined();
    expect(getConversationById(keepConv)).toBeDefined();
    expect(getGoalById(keepGoal.id)).toBeDefined();
  });
});
