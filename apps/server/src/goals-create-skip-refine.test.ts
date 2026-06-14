import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nanoid } from "nanoid";

const refineGoalMock = vi.fn();

vi.mock("@openx/coach", () => ({
  refineGoal: (...args: unknown[]) => refineGoalMock(...args),
}));

vi.mock("../orchestrator.js", () => ({
  detectExecutors: vi.fn(async () => [{ id: "pi", name: "Pi", selectable: true }]),
  dispatchGoal: vi.fn(),
  cancelRunning: vi.fn(),
}));

vi.mock("../executor-recommend-service.js", () => ({
  recommendExecutorForGoal: vi.fn(),
  resolveGoalExecutorId: vi.fn(async () => ({
    executorId: "pi",
    recommendReason: undefined,
  })),
}));

vi.mock("../settings-store.js", () => ({
  loadSettings: vi.fn(() => ({
    defaultConstraints: [],
    autoExecute: false,
    model: { coach: "x/y", pi: "x/y", default: "x/y" },
    providers: {},
  })),
}));

vi.mock("../goal-lifecycle.js", () => ({
  claimGoalForDispatch: vi.fn(() => undefined),
  cancelGoalStatus: vi.fn(),
}));

vi.mock("../narration.js", () => ({
  narrateGoalChange: vi.fn(),
}));

import { Hono } from "hono";
import {
  insertConversation,
  insertProject,
  resetDb,
} from "./db.js";
import { goalsRoutes } from "./routes/goals.js";

function seedConversation(id = "conv-1") {
  const now = new Date().toISOString();
  insertProject({
    id: "proj-1",
    name: "Test",
    workspaceDir: process.cwd(),
    createdAt: now,
  });
  insertConversation({
    id,
    projectId: "proj-1",
    title: "对话",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

describe("POST /goals skip refine when refinedMessageId", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
    refineGoalMock.mockReset();
    refineGoalMock.mockResolvedValue({
      refined: {
        title: "LLM 标题",
        acceptance: "LLM 验收",
        executionPrompt: "LLM 说明",
        constraints: [],
      },
    });
  });

  afterEach(() => {
    resetDb();
    delete process.env.OPENX_DB_PATH;
  });

  it("does not call refineGoal when refinedMessageId and fields are complete", async () => {
    const conversationId = seedConversation();
    const app = new Hono().route("/api/goals", goalsRoutes);
    const res = await app.request("/api/goals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversationId,
        userDraft: "优化登录页",
        title: "优化登录页",
        acceptance: "样式一致",
        executionPrompt: "调整登录页 CSS",
        executorId: "pi",
        refinedMessageId: 42,
      }),
    });
    expect(res.status).toBe(201);
    expect(refineGoalMock).not.toHaveBeenCalled();
    const body = (await res.json()) as { goal: { title: string } };
    expect(body.goal.title).toBe("优化登录页");
  });

  it("still calls refineGoal when fields are incomplete", async () => {
    const conversationId = seedConversation(nanoid());
    const app = new Hono().route("/api/goals", goalsRoutes);
    const res = await app.request("/api/goals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversationId,
        userDraft: "做个登录功能",
        executorId: "pi",
      }),
    });
    expect(res.status).toBe(201);
    expect(refineGoalMock).toHaveBeenCalled();
  });
});
