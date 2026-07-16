import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Goal } from "@openx/shared";
import {
  getGoalById,
  insertConversation,
  insertGoal,
  insertProject,
  listLogs,
  resetDb,
} from "./db.js";
import {
  clearTaskCommandIdempotencyCache,
  executeTaskCommand,
} from "./task-command.js";
import { resetOrchestrator } from "./orchestrator.js";
import { resetRunService } from "./run-service.js";

function seedDraft(): Goal {
  const now = new Date().toISOString();
  insertProject({
    id: "p-cmd",
    name: "cmd",
    workspaceDir: process.cwd(),
    createdAt: now,
  });
  insertConversation({
    id: "conv-cmd",
    projectId: "p-cmd",
    title: "命令",
    createdAt: now,
    updatedAt: now,
  });
  const goal: Goal = {
    id: "goal-cmd",
    conversationId: "conv-cmd",
    title: "命令任务",
    acceptance: "ok",
    executionPrompt: "do",
    constraints: [],
    executorId: "pi",
    status: "draft",
    progress: 0,
    createdAt: now,
    updatedAt: now,
  };
  insertGoal(goal);
  return goal;
}

describe("executeTaskCommand", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    process.env.OPENX_MOCK_PI = "1";
    resetDb();
    resetOrchestrator();
    resetRunService();
    clearTaskCommandIdempotencyCache();
  });

  afterEach(() => {
    resetDb();
    resetRunService();
    resetOrchestrator();
    clearTaskCommandIdempotencyCache();
    delete process.env.OPENX_DB_PATH;
    delete process.env.OPENX_MOCK_PI;
  });

  it("拒绝跨会话 cancel", async () => {
    const goal = seedDraft();
    const result = await executeTaskCommand({
      type: "cancel",
      goalId: goal.id,
      source: "api",
      actor: { type: "conversation", conversationId: "other-conv" },
      reason: "越权",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });

  it("cancel 写审计日志", async () => {
    const goal = seedDraft();
    const result = await executeTaskCommand({
      type: "cancel",
      goalId: goal.id,
      source: "ui",
      actor: { type: "conversation", conversationId: "conv-cmd" },
      reason: "不要了",
    });
    expect(result.ok).toBe(true);
    expect(getGoalById(goal.id)?.status).toBe("cancelled");
    const logs = listLogs(goal.id).map((l) => l.message);
    expect(logs.some((m) => m.includes("终止") && m.includes("不要了"))).toBe(true);
  });

  it("幂等键重复返回 replay", async () => {
    const goal = seedDraft();
    const cmd = {
      type: "cancel" as const,
      goalId: goal.id,
      source: "api" as const,
      actor: { type: "console" as const },
      idempotencyKey: "idem-1",
      reason: "一次",
    };
    const first = await executeTaskCommand(cmd);
    const second = await executeTaskCommand(cmd);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.idempotentReplay).toBe(true);
  });

  it("pause 将 running 置为 paused", async () => {
    const goal = seedDraft();
    const { updateGoal } = await import("./db.js");
    updateGoal({
      ...goal,
      status: "running",
      progress: 20,
      updatedAt: new Date().toISOString(),
    });
    const result = await executeTaskCommand({
      type: "pause",
      goalId: goal.id,
      source: "ui",
      actor: { type: "conversation", conversationId: "conv-cmd" },
      reason: "开发商介入",
    });
    expect(result.ok).toBe(true);
    expect(getGoalById(goal.id)?.status).toBe("paused");
  });

  it("approve 将 awaiting_review 置为 done", async () => {
    const goal = seedDraft();
    const { updateGoal } = await import("./db.js");
    updateGoal({
      ...goal,
      status: "awaiting_review",
      progress: 100,
      resultSummary: "已完成交付",
      updatedAt: new Date().toISOString(),
    });
    const result = await executeTaskCommand({
      type: "approve",
      goalId: goal.id,
      source: "ui",
      actor: { type: "conversation", conversationId: "conv-cmd" },
    });
    expect(result.ok).toBe(true);
    expect(getGoalById(goal.id)?.status).toBe("done");
  });

  it("resume 在无 paused 时失败", async () => {
    const goal = seedDraft();
    const result = await executeTaskCommand({
      type: "resume",
      goalId: goal.id,
      source: "ui",
      actor: { type: "conversation", conversationId: "conv-cmd" },
      userDecision: "继续",
    });
    expect(result.ok).toBe(false);
  });

  it("rework 在非 awaiting_review 时失败", async () => {
    const goal = seedDraft();
    const result = await executeTaskCommand({
      type: "rework",
      goalId: goal.id,
      source: "ui",
      actor: { type: "conversation", conversationId: "conv-cmd" },
      reworkReason: "还要改",
    });
    expect(result.ok).toBe(false);
  });
});
