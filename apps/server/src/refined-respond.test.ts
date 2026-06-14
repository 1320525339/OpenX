import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { WORK_ORDER_TOOL_NAME } from "@openx/shared";

const continueMock = vi.fn();

vi.mock("@openx/coach", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openx/coach")>();
  return {
    ...actual,
    coachContinueAfterWorkOrderTool: (...args: unknown[]) => continueMock(...args),
  };
});

vi.mock("../coach-stream.js", () => ({
  createCoachStreamBroadcaster: () => ({
    onDelta: vi.fn(),
    flushPending: vi.fn(),
    abort: vi.fn(),
    end: vi.fn(),
  }),
}));

import {
  hasWorkOrderToolResult,
  insertConversation,
  insertProject,
  resetDb,
  saveCoachRefinedMessage,
} from "./db.js";
import { coachRoutes } from "./routes/coach.js";

function seed() {
  const now = new Date().toISOString();
  insertProject({
    id: "p1",
    name: "T",
    workspaceDir: process.cwd(),
    createdAt: now,
  });
  insertConversation({
    id: "c1",
    projectId: "p1",
    title: "对话",
    createdAt: now,
    updatedAt: now,
  });
}

describe("POST /refined/:id/respond atomicity", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
    continueMock.mockReset();
    seed();
  });

  afterEach(() => {
    resetDb();
    delete process.env.OPENX_DB_PATH;
  });

  it("does not persist tool_result when LLM continuation fails", async () => {
    const refined = saveCoachRefinedMessage("c1", {
      title: "任务",
      acceptance: "验收",
      executionPrompt: "执行",
      constraints: [],
      priority: "medium",
    });
    continueMock.mockRejectedValue(new Error("LLM down"));

    const app = new Hono().route("/api/coach", coachRoutes);
    const res = await app.request(`/api/coach/refined/${refined.id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversationId: "c1",
        outcome: "confirmed",
      }),
    });

    expect(res.status).toBe(500);
    expect(hasWorkOrderToolResult("c1", refined.id)).toBe(false);
  });

  it("persists tool_result after LLM success", async () => {
    const refined = saveCoachRefinedMessage("c1", {
      title: "任务",
      acceptance: "验收",
      executionPrompt: "执行",
      constraints: [],
      priority: "medium",
    });
    continueMock.mockResolvedValue({ message: "收到" });

    const app = new Hono().route("/api/coach", coachRoutes);
    const res = await app.request(`/api/coach/refined/${refined.id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversationId: "c1",
        outcome: "confirmed",
      }),
    });

    expect(res.status).toBe(200);
    expect(hasWorkOrderToolResult("c1", refined.id)).toBe(true);
    expect(continueMock).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: WORK_ORDER_TOOL_NAME }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      undefined,
      expect.anything(),
    );
  });
});
