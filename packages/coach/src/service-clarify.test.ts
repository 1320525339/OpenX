import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLARIFY_TOOL_NAME } from "@openx/shared";

vi.mock("./llm.js", () => ({
  refineGoalLlm: vi.fn(),
  coachChatStreamLlm: vi.fn(),
  coachAgentReplyLlm: vi.fn(async (_message, _ctx, _settings, _env, _history, options) => {
    if (options?.promptMode === "structured") {
      return {
        message: "需要先确认范围",
        clarify: {
          questions: [
            {
              id: "scope",
              prompt: "你想改哪一块？",
              options: [
                { id: "ui", label: "界面" },
                { id: "api", label: "接口" },
              ],
            },
          ],
          status: "pending" as const,
        },
        intent: "consult" as const,
      };
    }
    if (options?.promptMode === "clarify_continuation") {
      return {
        message: "已整理任务单",
        refined: {
          title: "优化登录页",
          acceptance: "页面可访问且样式一致",
          executionPrompt: "调整登录页样式",
          constraints: [],
          priority: "normal" as const,
        },
        intent: "task" as const,
      };
    }
    return { message: "ok", intent: "consult" as const };
  }),
  resolveLlmCredentials: vi.fn(() => ({
    apiKey: "k",
    baseUrl: "https://example.com/v1",
    model: "test",
  })),
}));

import { coachChatReply, coachContinueAfterClarifyTool } from "./service.js";
import { coachAgentReplyLlm } from "./llm.js";

const settings = {
  model: { coach: "x/y", pi: "x/y", default: "x/y" },
  providers: {},
};

beforeEach(() => {
  vi.mocked(coachAgentReplyLlm).mockClear();
});

describe("coachChatReply clarify", () => {
  it("returns structured clarify for ambiguous task message", async () => {
    const result = await coachChatReply("帮我优化一下", {}, settings);
    expect(result.clarify?.questions).toHaveLength(1);
    expect(result.suggestRefine).toBeUndefined();
    expect(result.refined).toBeUndefined();
  });

  it("uses structured mode for explicit task messages", async () => {
    const result = await coachChatReply("帮我实现登录接口", {}, settings);
    expect(result.refined?.title.length).toBeGreaterThan(0);
    expect(result.clarify).toBeUndefined();
  });

  it("falls back to rule clarify when structured LLM throws on ambiguous task", async () => {
    vi.mocked(coachAgentReplyLlm).mockRejectedValueOnce(new Error("timeout"));
    const result = await coachChatReply("帮我优化一下", {}, settings);
    expect(result.clarify?.questions?.length).toBeGreaterThan(1);
    expect(result.message).toContain("澄清");
    expect(result.refined).toBeUndefined();
  });

  it("falls back to rules refined when structured LLM throws on explicit task", async () => {
    vi.mocked(coachAgentReplyLlm)
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({ message: "ok", intent: "consult" as const });
    const result = await coachChatReply("帮我实现 JWT 登录", {}, settings);
    expect(result.refined?.title.length).toBeGreaterThan(0);
    expect(result.clarify).toBeUndefined();
  });

  it("rules refined when structured LLM returns message without refined", async () => {
    vi.mocked(coachAgentReplyLlm).mockResolvedValueOnce({
      message: "好的，我来整理",
      intent: "task" as const,
    });
    const result = await coachChatReply(
      "帮我实现登录 API，验收返回 200",
      {},
      settings,
    );
    expect(result.refined?.title.length).toBeGreaterThan(0);
    expect(result.clarify).toBeUndefined();
  });

  it("skips structured mode when forceRefine is set", async () => {
    vi.mocked(coachAgentReplyLlm).mockClear();
    vi.mocked(coachAgentReplyLlm).mockResolvedValueOnce({
      message: "已整理",
      refined: {
        title: "优化登录",
        acceptance: "可登录",
        executionPrompt: "实现登录",
        constraints: [],
        priority: "medium" as const,
      },
      intent: "task" as const,
    });
    await coachChatReply(
      "帮我优化一下",
      {},
      settings,
      [],
      undefined,
      [],
      { forceRefine: true },
    );
    const structuredCalls = vi
      .mocked(coachAgentReplyLlm)
      .mock.calls.filter((call) => call[5]?.promptMode === "structured");
    expect(structuredCalls).toHaveLength(0);
  });
});

describe("coachChatReply clarify vs refined", () => {
  it("does not add rules refined when LLM returns clarify", async () => {
    vi.mocked(coachAgentReplyLlm).mockResolvedValueOnce({
      message: "先确认",
      clarify: {
        questions: [{ id: "q1", prompt: "范围？", options: [{ id: "a", label: "A" }] }],
        status: "pending" as const,
      },
      refined: {
        title: "冲突工单",
        acceptance: "不应出现",
        executionPrompt: "执行",
        constraints: [],
        priority: "medium" as const,
      },
      intent: "consult" as const,
    });
    const result = await coachChatReply("帮我优化一下", {}, settings);
    expect(result.clarify?.questions).toHaveLength(1);
    expect(result.refined).toBeUndefined();
  });
});

describe("coachContinueAfterClarifyTool", () => {
  it("appends refine hint when clarify is dismissed", async () => {
    const result = await coachContinueAfterClarifyTool(
      {
        toolName: CLARIFY_TOOL_NAME,
        clarifyMessageId: 2,
        outcome: "dismissed",
      },
      {
        questions: [{ id: "scope", prompt: "范围？" }],
        status: "pending",
      },
      {},
      settings,
    );
    expect(result.message).toContain("整理成任务单");
  });

  it("produces refined after answered clarify tool result", async () => {
    const clarifyPayload = {
      questions: [{ id: "scope", prompt: "范围？", options: [{ id: "ui", label: "界面" }] }],
      status: "pending" as const,
    };
    const result = await coachContinueAfterClarifyTool(
      {
        toolName: CLARIFY_TOOL_NAME,
        clarifyMessageId: 1,
        outcome: "answered",
        answers: { scope: "ui" },
      },
      clarifyPayload,
      {},
      settings,
    );
    expect(result.refined?.title).toBe("优化登录页");
    expect(result.message).toContain("任务单");
  });
});
