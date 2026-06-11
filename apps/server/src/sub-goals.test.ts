import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { nanoid } from "nanoid";
import type { Goal } from "@openx/shared";
import { insertGoal, resetDb } from "./db.js";
import { registerConnection, resetConnections } from "./connect-store.js";
import { buildCoachChatContext } from "./coach-context.js";
import {
  seedTestProjectAndConversation,
  TEST_CONVERSATION_ID,
} from "./test-helpers.js";

vi.mock("@openx/coach", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openx/coach")>();
  return {
    ...actual,
    refineGoal: vi.fn(async (input: { userDraft: string }) => ({
      refined: {
        title: input.userDraft.slice(0, 24),
        acceptance: "验收通过",
        executionPrompt: input.userDraft,
        constraints: [],
      },
    })),
    coachChatReply: vi.fn(async () => ({ message: "ok" })),
  };
});

import {
  createSubGoalsUnderParent,
  refinedSubGoalsToInput,
} from "./sub-goals.js";

function makeGoal(overrides: Partial<Goal> & Pick<Goal, "title">): Goal {
  const now = new Date().toISOString();
  return {
    id: nanoid(),
    conversationId: TEST_CONVERSATION_ID,
    title: overrides.title,
    acceptance: overrides.acceptance ?? "验收通过",
    executionPrompt: overrides.executionPrompt ?? "执行",
    constraints: overrides.constraints ?? [],
    executorId: "pi",
    status: overrides.status ?? "draft",
    progress: overrides.progress ?? 0,
    userDraft: overrides.userDraft,
    resultSummary: overrides.resultSummary,
    effectStatus: overrides.effectStatus,
    reworkReason: overrides.reworkReason,
    parentGoalId: overrides.parentGoalId,
    dependsOn: overrides.dependsOn ?? [],
    priority: overrides.priority ?? "medium",
    createdAt: now,
    updatedAt: now,
  };
}

describe("sub-goals", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
    seedTestProjectAndConversation();
    resetConnections();
  });

  afterEach(() => {
    resetDb();
    resetConnections();
    delete process.env.OPENX_DB_PATH;
  });

  it("refinedSubGoalsToInput maps coach sub goals", () => {
    const input = refinedSubGoalsToInput([
      {
        title: "写 API",
        acceptance: "接口可用",
        executionPrompt: "实现 POST /login",
      },
    ]);
    expect(input[0]?.title).toBe("写 API");
    expect(input[0]?.userDraft).toBe("实现 POST /login");
  });

  it("createSubGoalsUnderParent chains dependsOn from parent", async () => {
    const parent = makeGoal({ title: "核心目标", status: "running" });
    insertGoal(parent);

    const children = await createSubGoalsUnderParent(
      parent.id,
      [
        {
          userDraft: "第一步",
          title: "步骤一",
          acceptance: "完成一",
          executionPrompt: "做第一步",
        },
        {
          userDraft: "第二步",
          title: "步骤二",
          acceptance: "完成二",
          executionPrompt: "做第二步",
        },
      ],
      false,
    );

    expect(children).toHaveLength(2);
    expect(children[0]?.dependsOn).toEqual([]);
    expect(children[1]?.dependsOn).toEqual([children[0]!.id]);
    expect(children[0]?.parentGoalId).toBe(parent.id);
  });
});

describe("coach-context executors", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
    seedTestProjectAndConversation();
    resetConnections();
  });

  afterEach(() => {
    resetDb();
    resetConnections();
    delete process.env.OPENX_DB_PATH;
  });

  it("includes connect agents in executors list", () => {
    registerConnection({
      toolName: "cursor-agent",
      agentName: "Cursor Worker",
      executorId: "cursor-worker",
    });

    const ctx = buildCoachChatContext(TEST_CONVERSATION_ID);
    expect(ctx.executors).toContain("pi");
    expect(ctx.executors).toContain("acp:gemini");
    expect(ctx.executors?.some((e) => e.includes("Cursor Worker"))).toBe(true);
  });
});
