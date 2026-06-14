import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { CLARIFY_TOOL_NAME } from "@openx/shared";

const continueMock = vi.fn();

vi.mock("@openx/coach", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openx/coach")>();
  return {
    ...actual,
    coachContinueAfterClarifyTool: (...args: unknown[]) => continueMock(...args),
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

vi.mock("../refined-backfill.js", () => ({
  backfillRefinedGoal: vi.fn(async (refined: unknown) => refined),
}));

import {
  hasClarifyToolResult,
  insertConversation,
  insertProject,
  listCoachMessages,
  resetDb,
  saveCoachClarifyMessage,
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

describe("POST /clarify/:id/respond atomicity", () => {
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
    const clarify = saveCoachClarifyMessage("c1", {
      title: "确认",
      questions: [
        {
          id: "scope",
          prompt: "范围？",
          options: [{ id: "api", label: "API" }],
        },
      ],
      status: "pending",
    });
    continueMock.mockRejectedValue(new Error("LLM down"));

    const app = new Hono().route("/api/coach", coachRoutes);
    const res = await app.request(`/api/coach/clarify/${clarify.id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversationId: "c1",
        outcome: "answered",
        answers: { scope: "api" },
      }),
    });

    expect(res.status).toBe(500);
    expect(hasClarifyToolResult("c1", clarify.id)).toBe(false);
    const row = listCoachMessages("c1").find((m) => m.kind === "clarify");
    expect(row?.kind === "clarify" ? row.clarify.status : null).toBe("pending");
  });

  it("persists tool_result and updates status after LLM success", async () => {
    const clarify = saveCoachClarifyMessage("c1", {
      questions: [
        {
          id: "scope",
          prompt: "范围？",
          options: [{ id: "api", label: "API" }],
        },
      ],
      status: "pending",
    });
    continueMock.mockResolvedValue({
      message: "已整理",
      refined: {
        title: "任务",
        acceptance: "验收",
        executionPrompt: "执行",
        constraints: [],
        priority: "medium",
      },
    });

    const app = new Hono().route("/api/coach", coachRoutes);
    const res = await app.request(`/api/coach/clarify/${clarify.id}/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversationId: "c1",
        outcome: "answered",
        answers: { scope: "api" },
      }),
    });

    expect(res.status).toBe(200);
    expect(hasClarifyToolResult("c1", clarify.id)).toBe(true);
    const toolRows = listCoachMessages("c1").filter((m) => m.kind === "tool_result");
    expect(toolRows[0]?.kind === "tool_result" ? toolRows[0].toolResult.toolName : null).toBe(
      CLARIFY_TOOL_NAME,
    );
    const clarifyRow = listCoachMessages("c1").find((m) => m.kind === "clarify");
    expect(clarifyRow?.kind === "clarify" ? clarifyRow.clarify.status : null).toBe(
      "answered",
    );
    const refinedRow = listCoachMessages("c1").find((m) => m.kind === "refined");
    expect(refinedRow?.kind === "refined" ? refinedRow.refined.title : null).toBe("任务");
    expect(
      clarifyRow?.kind === "clarify" ? clarifyRow.linkedRefinedMessageId : null,
    ).toBe(refinedRow?.id);
    expect(
      refinedRow?.kind === "refined" ? refinedRow.linkedClarifyMessageId : null,
    ).toBe(clarify.id);
  });
});
