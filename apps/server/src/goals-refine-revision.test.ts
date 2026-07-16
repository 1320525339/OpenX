import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("../goal-lifecycle.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./goal-lifecycle.js")>();
  return {
    ...actual,
    claimGoalForDispatch: vi.fn(() => undefined),
    cancelGoalStatus: vi.fn(),
  };
});

vi.mock("../narration.js", () => ({
  narrateGoalChange: vi.fn(),
}));

import { Hono } from "hono";
import type { Goal } from "@openx/shared";
import {
  getGoalById,
  insertConversation,
  insertGoal,
  insertProject,
  resetDb,
} from "./db.js";
import { goalsRoutes } from "./routes/goals.js";

function seedGoal(): Goal {
  const now = new Date().toISOString();
  insertProject({
    id: "proj-refine",
    name: "Test",
    workspaceDir: process.cwd(),
    createdAt: now,
  });
  insertConversation({
    id: "conv-refine",
    projectId: "proj-refine",
    title: "对话",
    createdAt: now,
    updatedAt: now,
  });
  const goal: Goal = {
    id: "g-refine",
    conversationId: "conv-refine",
    title: "原稿",
    acceptance: "旧验收",
    executionPrompt: "旧说明",
    constraints: [],
    executorId: "pi",
    status: "draft",
    progress: 0,
    userDraft: "请细化这个目标",
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
  insertGoal(goal);
  return goal;
}

describe("POST /goals/:id/refine revision", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
    refineGoalMock.mockReset();
    refineGoalMock.mockResolvedValue({
      refined: {
        title: "新标题",
        acceptance: "新验收",
        executionPrompt: "新说明",
        constraints: ["c1"],
      },
    });
  });

  afterEach(() => {
    resetDb();
    delete process.env.OPENX_DB_PATH;
  });

  it("returns and persists bumped revision so subsequent PATCH does not 409", async () => {
    seedGoal();
    const app = new Hono();
    app.route("/api/goals", goalsRoutes);

    const refineRes = await app.request("/api/goals/g-refine/refine", { method: "POST" });
    expect(refineRes.status).toBe(200);
    const refineBody = (await refineRes.json()) as { goal: Goal };
    expect(refineBody.goal.revision).toBe(1);
    expect(getGoalById("g-refine")?.revision).toBe(1);

    const patchRes = await app.request("/api/goals/g-refine", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseRevision: refineBody.goal.revision,
        title: "客户端再改",
      }),
    });
    expect(patchRes.status).toBe(200);
    const patchBody = (await patchRes.json()) as { goal: Goal };
    expect(patchBody.goal.title).toBe("客户端再改");
    expect(patchBody.goal.revision).toBe(2);
  });
});
