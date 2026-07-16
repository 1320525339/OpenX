import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./llm.js", () => ({
  refineGoalLlm: vi.fn(),
  coachChatStreamLlm: vi.fn(async (_message, _ctx, _settings, onDelta) => {
    await onDelta("你");
    await onDelta("好");
    return "你好呀";
  }),
  coachAgentReplyLlm: vi.fn(async (_message, _ctx, _settings, _env, _history, options) => {
    if (options?.promptMode === "structured") {
      return {
        message: "已整理任务单",
        refined: {
          title: "实现登录接口",
          acceptance: "接口可调用",
          executionPrompt: "实现登录",
          constraints: [],
          priority: "normal" as const,
        },
        intent: "task" as const,
      };
    }
    return { message: "fallback", intent: "consult" as const };
  }),
  resolveLlmCredentials: vi.fn(() => ({
    apiKey: "k",
    baseUrl: "https://example.com/v1",
    model: "test",
  })),
}));

import { coachChatReply } from "./service.js";
import { coachAgentReplyLlm, coachChatStreamLlm } from "./llm.js";

const settings = {
  model: { coach: "x/y", pi: "x/y", default: "x/y" },
  providers: {},
};

beforeEach(() => {
  vi.mocked(coachAgentReplyLlm).mockClear();
  vi.mocked(coachChatStreamLlm).mockClear();
});

describe("coachChatReply streaming gate", () => {
  it("streams chitchat when onDelta is provided", async () => {
    const deltas: string[] = [];
    const result = await coachChatReply(
      "你好",
      {},
      settings,
      [],
      undefined,
      [],
      {
        onDelta: async (d) => {
          deltas.push(d);
        },
      },
    );
    expect(result.streamed).toBe(true);
    expect(result.message).toBe("你好呀");
    expect(deltas.join("")).toBe("你好");
    expect(coachChatStreamLlm).toHaveBeenCalledOnce();
    expect(coachAgentReplyLlm).not.toHaveBeenCalled();
  });

  it("streams progress consult when onDelta is provided", async () => {
    const result = await coachChatReply(
      "最近进展怎么样？",
      {},
      settings,
      [],
      undefined,
      [],
      { onDelta: async () => {} },
    );
    expect(result.streamed).toBe(true);
    expect(coachChatStreamLlm).toHaveBeenCalledOnce();
    expect(coachAgentReplyLlm).not.toHaveBeenCalled();
  });

  it("does not stream explicit task; uses structured instead", async () => {
    const onDelta = vi.fn(async () => {});
    const result = await coachChatReply(
      "帮我实现登录接口",
      {},
      settings,
      [],
      undefined,
      [],
      { onDelta },
    );
    expect(result.streamed).toBeUndefined();
    expect(onDelta).not.toHaveBeenCalled();
    expect(coachChatStreamLlm).not.toHaveBeenCalled();
    expect(coachAgentReplyLlm).toHaveBeenCalled();
    expect(result.refined?.title).toContain("登录");
  });

  it("streams work-order dismiss even without shouldUseCoachStreaming intent", async () => {
    const result = await coachChatReply(
      "取消任务单",
      {},
      settings,
      [],
      undefined,
      [],
      { onDelta: async () => {}, skipRefine: true },
    );
    expect(result.streamed).toBe(true);
    expect(coachChatStreamLlm).toHaveBeenCalledOnce();
    expect(coachAgentReplyLlm).not.toHaveBeenCalled();
  });
});
