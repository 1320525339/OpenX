import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCoachRuntime,
  resolveForemanDirectiveViaCoach,
  resolveForemanTurnReviewViaCoach,
} from "@openx/coach";
import { handleCrewQuestion, handleCrewTurnReview } from "./foreman-loop.js";
import { resetDb, insertGoal, insertProject, insertConversation } from "./db.js";

vi.mock("@openx/coach", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openx/coach")>();
  return {
    ...actual,
    resolveForemanDirectiveViaCoach: vi.fn(),
    resolveForemanTurnReviewViaCoach: vi.fn(),
    getCoachRuntime: vi.fn(),
  };
});

function seedGoal() {
  const now = new Date().toISOString();
  insertProject({
    id: "p-foreman-loop",
    name: "foreman-loop",
    workspaceDir: process.cwd(),
    createdAt: now,
  });
  insertConversation({
    id: "conv-1",
    projectId: "p-foreman-loop",
    title: "工头",
    createdAt: now,
    updatedAt: now,
  });
  insertGoal({
    id: "g1",
    conversationId: "conv-1",
    title: "小游戏",
    acceptance: "可运行",
    executionPrompt: "写 HTML 游戏",
    constraints: [],
    executorId: "acp:claude",
    status: "running",
    progress: 0,
    foremanThreadId: "conv-1",
    createdAt: now,
    updatedAt: now,
  });
}

const goal = {
  id: "g1",
  title: "小游戏",
  conversationId: "conv-1",
  foremanThreadId: "conv-1",
  acceptance: "可运行",
  executionPrompt: "写 HTML 游戏",
  constraints: [] as string[],
};

describe("foreman-loop", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
    seedGoal();
    vi.mocked(resolveForemanDirectiveViaCoach).mockReset();
    vi.mocked(resolveForemanTurnReviewViaCoach).mockReset();
    vi.mocked(getCoachRuntime).mockReset();
    delete process.env.OPENX_FOREMAN_RULES_ONLY;
  });

  afterEach(() => {
    resetDb();
    delete process.env.OPENX_DB_PATH;
    delete process.env.OPENX_FOREMAN_RULES_ONLY;
  });

  it("uses LLM foreman when coach is ready", async () => {
    vi.mocked(getCoachRuntime).mockReturnValue({
      ready: true,
      model: "test",
    });
    vi.mocked(resolveForemanDirectiveViaCoach).mockResolvedValue({
      outcome: {
        kind: "directive",
        message: "选方案A",
        selectedOptionId: "a",
        source: "foreman_llm",
      },
    });

    const outcome = await handleCrewQuestion({
      goal,
      question: {
        kind: "question",
        prompt: "A or B",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      },
    });

    expect(outcome).toMatchObject({
      kind: "directive",
      selectedOptionId: "a",
      source: "foreman_llm",
    });
    expect(resolveForemanDirectiveViaCoach).toHaveBeenCalledOnce();
  });

  it("falls back when LLM fails", async () => {
    vi.mocked(getCoachRuntime).mockReturnValue({ ready: true, model: "test" });
    vi.mocked(resolveForemanDirectiveViaCoach).mockResolvedValue({
      outcome: null,
      llmError: "parse failed",
    });

    const outcome = await handleCrewQuestion({
      goal,
      question: {
        kind: "question",
        prompt: "选方案",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      },
    });

    expect(outcome.kind).toBe("directive");
    if (outcome.kind === "directive") {
      expect(outcome.source).toBe("foreman_rule");
      expect(outcome.message).toContain("选方案");
    }
  });

  it("uses rules only when OPENX_FOREMAN_RULES_ONLY=1", async () => {
    process.env.OPENX_FOREMAN_RULES_ONLY = "1";
    vi.mocked(getCoachRuntime).mockReturnValue({ ready: true, model: "test" });

    const outcome = await handleCrewQuestion({
      goal,
      question: {
        kind: "question",
        prompt: "选方案",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      },
    });

    expect(resolveForemanDirectiveViaCoach).not.toHaveBeenCalled();
    if (outcome.kind === "directive") {
      expect(outcome.source).toBe("foreman_rule");
    }
  });

  it("skips LLM when coach runtime not ready", async () => {
    vi.mocked(getCoachRuntime).mockReturnValue({
      ready: false,
      error: "no model",
    });

    const outcome = await handleCrewQuestion({
      goal,
      question: {
        kind: "question",
        prompt: "选方案",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      },
    });

    expect(resolveForemanDirectiveViaCoach).not.toHaveBeenCalled();
    expect(outcome.kind).toBe("directive");
  });

  it("uses LLM for foreman turn review when coach is ready", async () => {
    vi.mocked(getCoachRuntime).mockReturnValue({
      ready: true,
      model: "test",
    });
    vi.mocked(resolveForemanTurnReviewViaCoach).mockResolvedValue({
      decision: {
        action: "continue",
        message: "补 README",
        source: "foreman_llm",
      },
    });

    const decision = await handleCrewTurnReview({
      goal,
      turn: {
        assistantText: "写了 index.html",
        summary: "进行中",
      },
    });

    expect(decision.action).toBe("continue");
    expect(resolveForemanTurnReviewViaCoach).toHaveBeenCalledOnce();
  });

  it("falls back turn review when LLM fails", async () => {
    vi.mocked(getCoachRuntime).mockReturnValue({ ready: true, model: "test" });
    vi.mocked(resolveForemanTurnReviewViaCoach).mockResolvedValue({
      decision: null,
      llmError: "empty",
    });

    const decision = await handleCrewTurnReview({
      goal,
      turn: {
        assistantText: "建议方案 A。确认后执行。",
        summary: "待确认",
      },
    });

    expect(decision.action).toBe("ask_user");
    expect(decision.source).toBe("foreman_rule");
  });
});
