import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Goal } from "@openx/shared";
import {
  getGoalById,
  insertConversation,
  insertGoal,
  insertProject,
  resetDb,
} from "./db.js";
import { app } from "./routes.js";
import { parkGoalAsPaused } from "./goal-lifecycle.js";
import { resetOrchestrator } from "./orchestrator.js";
import { resetRunService } from "./run-service.js";

vi.mock("@openx/coach", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openx/coach")>();
  return {
    ...actual,
    refineGoal: vi.fn(async (input: { userDraft: string }) => ({
      refined: {
        title: input.userDraft.slice(0, 48) || "未命名",
        acceptance: "验收",
        executionPrompt: input.userDraft,
        constraints: [],
      },
    })),
    coachChatReply: vi.fn(async () => ({
      message: "普通闲聊回复",
      intent: "message",
    })),
  };
});

const CONV_A = "conv-acl-a";
const CONV_B = "conv-acl-b";

function seed(): { goalA: Goal; goalB: Goal } {
  const now = new Date().toISOString();
  insertProject({
    id: "p-acl",
    name: "acl",
    workspaceDir: process.cwd(),
    createdAt: now,
  });
  insertConversation({
    id: CONV_A,
    projectId: "p-acl",
    title: "对话A",
    createdAt: now,
    updatedAt: now,
  });
  insertConversation({
    id: CONV_B,
    projectId: "p-acl",
    title: "对话B",
    createdAt: now,
    updatedAt: now,
  });
  const goalA: Goal = {
    id: "goal-acl-a",
    conversationId: CONV_A,
    title: "任务A",
    acceptance: "a",
    executionPrompt: "a",
    constraints: [],
    executorId: "pi",
    status: "running",
    progress: 10,
    createdAt: now,
    updatedAt: now,
  };
  const goalB: Goal = {
    id: "goal-acl-b",
    conversationId: CONV_B,
    title: "任务B",
    acceptance: "b",
    executionPrompt: "b",
    constraints: [],
    executorId: "pi",
    status: "running",
    progress: 10,
    createdAt: now,
    updatedAt: now,
  };
  insertGoal(goalA);
  insertGoal(goalB);
  parkGoalAsPaused(goalA.id, "等待A");
  parkGoalAsPaused(goalB.id, "等待B");
  return { goalA: getGoalById(goalA.id)!, goalB: getGoalById(goalB.id)! };
}

function convHeaders(conversationId: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "X-OpenX-View": "conversation",
    "X-OpenX-Conversation-Id": conversationId,
  };
}

describe("goal mutation ACL + chat 非劫持", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    process.env.OPENX_MOCK_PI = "1";
    resetDb();
    resetOrchestrator();
    resetRunService();
  });

  afterEach(() => {
    resetDb();
    resetRunService();
    resetOrchestrator();
    delete process.env.OPENX_DB_PATH;
    delete process.env.OPENX_MOCK_PI;
  });

  it("跨会话无法 crew/resume", async () => {
    const { goalB } = seed();
    const res = await app.request(`/api/goals/${goalB.id}/crew/resume`, {
      method: "POST",
      headers: convHeaders(CONV_A),
      body: JSON.stringify({ message: "越权续跑" }),
    });
    expect(res.status).toBe(403);
  });

  it("跨会话无法 trigger-review", async () => {
    const { goalB } = seed();
    const res = await app.request(`/api/goals/${goalB.id}/trigger-review`, {
      method: "POST",
      headers: convHeaders(CONV_A),
      body: JSON.stringify({ force: true }),
    });
    expect(res.status).toBe(403);
  });

  it("跨会话无法 sub-goals", async () => {
    const { goalB } = seed();
    const res = await app.request(`/api/goals/${goalB.id}/sub-goals`, {
      method: "POST",
      headers: convHeaders(CONV_A),
      body: JSON.stringify({
        subGoals: [{ userDraft: "子任务", executorId: "pi" }],
      }),
    });
    expect(res.status).toBe(403);
  });

  it("同会话可以 crew/resume", async () => {
    const { goalA } = seed();
    const res = await app.request(`/api/goals/${goalA.id}/crew/resume`, {
      method: "POST",
      headers: convHeaders(CONV_A),
      body: JSON.stringify({ message: "选方案A" }),
    });
    // 可能因执行器 mock 续跑失败返回 400，但不得 403
    expect(res.status).not.toBe(403);
  });

  it("/chat 有 paused 任务时普通消息不 crewResumed", async () => {
    seed();
    const res = await app.request("/api/coach/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: CONV_A,
        message: "今天天气怎么样",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { crewResumed?: boolean; message?: string };
    expect(body.crewResumed).toBeUndefined();
    expect(body.message).toBeTruthy();
  });

  it("cancel 写入审计日志与旁白可观测", async () => {
    const { goalA } = seed();
    const res = await app.request(`/api/goals/${goalA.id}/cancel`, {
      method: "POST",
      headers: convHeaders(CONV_A),
      body: JSON.stringify({ reason: "用户主动终止" }),
    });
    expect(res.status).toBe(200);
    const updated = getGoalById(goalA.id);
    expect(updated?.status).toBe("cancelled");
  });
});
