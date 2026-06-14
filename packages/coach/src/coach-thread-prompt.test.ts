import { createEmptyRunState } from "@openx/shared";
import { describe, expect, it } from "vitest";
import { buildChatUserPrompt } from "./prompts.js";
import {
  buildCoachThreadBlock,
  buildCoachThreadPrefixFromRecords,
  COACH_THREAD_HISTORY_HEADING,
} from "./coach-thread-prompt.js";

describe("buildCoachThreadBlock", () => {
  it("uses the same heading and labels as coach chat history", () => {
    const block = buildCoachThreadBlock([
      { role: "user", text: "帮我整理登录 API" },
      { role: "coach", text: "好的，我先看一下任务情况。" },
    ]);
    expect(block).toContain(COACH_THREAD_HISTORY_HEADING);
    expect(block).toContain("用户：帮我整理登录 API");
    expect(block).toContain("工头：好的，我先看一下任务情况。");
  });

  it("matches buildChatUserPrompt history section", () => {
    const history = [
      { role: "user" as const, text: "帮我整理登录 API" },
      { role: "coach" as const, text: "好的，我先看一下任务情况。" },
    ];
    const prompt = buildChatUserPrompt("继续刚才那个", history);
    const block = buildCoachThreadBlock(history);
    expect(prompt.startsWith(block)).toBe(true);
  });
});

describe("buildCoachThreadPrefixFromRecords", () => {
  it("returns undefined for empty records", () => {
    expect(buildCoachThreadPrefixFromRecords([])).toBeUndefined();
  });

  it("formats review-only message kinds with shared turn labels", () => {
    const prefix = buildCoachThreadPrefixFromRecords([
      {
        id: 1,
        conversationId: "c1",
        kind: "text",
        role: "user",
        text: "做一个登录页",
        timestamp: "t1",
      },
      {
        id: 2,
        conversationId: "c1",
        kind: "execution",
        timestamp: "t2",
        execution: {
          goalId: "g1",
          goalTitle: "登录页",
          goalStatus: "done",
          runId: "r1",
          run: createEmptyRunState("g1"),
        },
      },
    ]);
    expect(prefix).toContain(COACH_THREAD_HISTORY_HEADING);
    expect(prefix).toContain("用户：做一个登录页");
    expect(prefix).toContain("工头：[执行快照] 登录页 · done");
  });
});
