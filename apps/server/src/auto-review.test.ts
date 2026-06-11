import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Goal } from "@openx/shared";

const reviewGoalCompletionMock = vi.fn();
const refineGoalMock = vi.fn();

vi.mock("@openx/coach", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openx/coach")>();
  return {
    ...actual,
    reviewGoalCompletion: (...args: unknown[]) => reviewGoalCompletionMock(...args),
    reviewParentGoalCompletion: (...args: unknown[]) => reviewGoalCompletionMock(...args),
    refineGoal: (...args: unknown[]) => refineGoalMock(...args),
  };
});

vi.mock("./review-verify.js", () => ({
  runReviewVerification: vi.fn(() => []),
  formatVerifyEvidenceBlock: vi.fn(() => "## 验证命令输出（mock）\n（无）"),
}));

const { getGoalById, insertGoal, resetDb } = await import("./db.js");
const { maybeAutoReview, resetAutoReview } = await import("./auto-review.js");
const { seedTestProjectAndConversation, TEST_CONVERSATION_ID } = await import(
  "./test-helpers.js"
);

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  const now = new Date().toISOString();
  return {
    id: "g-auto-review",
    conversationId: TEST_CONVERSATION_ID,
    title: "测试目标",
    acceptance: "输出 hello.txt 文件",
    executionPrompt: "创建 hello.txt",
    constraints: [],
    executorId: "pi",
    status: "awaiting_review",
    progress: 100,
    resultSummary: "已创建 hello.txt",
    dependsOn: [],
    priority: "medium",
    autoReview: true,
    iterationCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("auto-review loop", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    process.env.OPENX_MOCK_PI = "1";
    resetDb();
    seedTestProjectAndConversation();
    resetAutoReview();
    reviewGoalCompletionMock.mockReset();
    refineGoalMock.mockReset();
    refineGoalMock.mockResolvedValue({
      refined: {
        title: "测试目标",
        acceptance: "输出 hello.txt 文件",
        executionPrompt: "重做：创建 hello.txt",
        constraints: [],
      },
    });
  });

  afterEach(() => {
    resetDb();
    resetAutoReview();
    delete process.env.OPENX_DB_PATH;
    delete process.env.OPENX_MOCK_PI;
  });

  it("verdict pass → 自动 approve 到 done", async () => {
    insertGoal(makeGoal());
    reviewGoalCompletionMock.mockResolvedValue({
      verdict: { verdict: "pass", reason: "验收标准已满足" },
    });

    await maybeAutoReview("g-auto-review");

    const goal = getGoalById("g-auto-review");
    expect(goal?.status).toBe("done");
    expect(goal?.effectStatus).toBe("approved");
  });

  it("verdict fail → 自动返工回 running 并递增迭代计数", async () => {
    insertGoal(makeGoal());
    reviewGoalCompletionMock.mockResolvedValue({
      verdict: {
        verdict: "fail",
        reason: "缺少文件",
        reworkInstruction: "请实际创建 hello.txt",
      },
    });

    await maybeAutoReview("g-auto-review");

    const goal = getGoalById("g-auto-review");
    expect(goal?.status).toBe("running");
    expect(goal?.effectStatus).toBe("rework");
    expect(goal?.iterationCount).toBe(1);
    expect(goal?.reworkReason).toContain("【审查未通过 · 第 1 轮】");
    expect(goal?.reworkReason).toContain("请实际创建 hello.txt");
  });

  it("达到迭代上限 → 保持 awaiting_review 等人工", async () => {
    insertGoal(makeGoal({ iterationCount: 4, maxIterations: 5 }));
    reviewGoalCompletionMock.mockResolvedValue({
      verdict: { verdict: "fail", reason: "仍未达标" },
    });

    await maybeAutoReview("g-auto-review");

    const goal = getGoalById("g-auto-review");
    expect(goal?.status).toBe("awaiting_review");
    expect(goal?.iterationCount).toBe(4);
  });

  it("LLM 不可用（verdict null）→ 保持 awaiting_review，不自动放行", async () => {
    insertGoal(makeGoal());
    reviewGoalCompletionMock.mockResolvedValue({
      verdict: null,
      llmError: "模型未配置",
    });

    await maybeAutoReview("g-auto-review");

    const goal = getGoalById("g-auto-review");
    expect(goal?.status).toBe("awaiting_review");
  });

  it("autoReview 未开启 → 不做任何事", async () => {
    insertGoal(makeGoal({ autoReview: false }));

    await maybeAutoReview("g-auto-review");

    expect(reviewGoalCompletionMock).not.toHaveBeenCalled();
    expect(getGoalById("g-auto-review")?.status).toBe("awaiting_review");
  });
});
