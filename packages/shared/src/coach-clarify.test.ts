import { describe, expect, it } from "vitest";
import {
  CLARIFY_TOOL_NAME,
  CoachClarifyPayloadSchema,
  CoachClarifyRespondSchema,
  clarifyQuestionAllowsFreeform,
  formatClarifyAnswersForPrompt,
  isClarifyQuestionAnswered,
  isClarifyQuestionVisible,
  validateClarifyRespondInput,
} from "./coach-clarify.js";
import { coachRecordsToChatTurns } from "./coach-thread.js";
import { WORK_ORDER_TOOL_NAME } from "./coach-messages.js";

describe("isClarifyQuestionVisible", () => {
  it("hides dependent question until parent option matches", () => {
    const questions = CoachClarifyPayloadSchema.parse({
      questions: [
        {
          id: "arch",
          prompt: "架构？",
          options: [
            { id: "mono", label: "单体" },
            { id: "micro", label: "微服务" },
          ],
        },
        {
          id: "svc",
          prompt: "拆哪些服务？",
          dependsOnIndex: 0,
          dependsOnOptionIds: ["micro"],
          options: [{ id: "auth", label: "认证" }],
        },
      ],
    }).questions;
    expect(isClarifyQuestionVisible(questions, 1, {})).toBe(false);
    expect(isClarifyQuestionVisible(questions, 1, { arch: "mono" })).toBe(false);
    expect(isClarifyQuestionVisible(questions, 1, { arch: "micro" })).toBe(true);
  });
});

describe("clarifyQuestionAllowsFreeform", () => {
  it("defaults to freeform when no options", () => {
    const q = CoachClarifyPayloadSchema.parse({
      questions: [{ id: "q1", prompt: "说明范围" }],
    }).questions[0]!;
    expect(clarifyQuestionAllowsFreeform(q)).toBe(true);
  });
});

describe("isClarifyQuestionAnswered", () => {
  it("accepts note-only for freeform question", () => {
    const payload = CoachClarifyPayloadSchema.parse({
      questions: [{ id: "q1", prompt: "说明范围" }],
    });
    expect(
      isClarifyQuestionAnswered(
        payload.questions[0]!,
        payload.questions,
        0,
        {},
        { q1: { notes: "只要后端" } },
      ),
    ).toBe(true);
  });
});

describe("validateClarifyRespondInput", () => {
  it("rejects empty answered payload", () => {
    const payload = CoachClarifyPayloadSchema.parse({
      questions: [
        {
          id: "scope",
          prompt: "范围？",
          options: [{ id: "api", label: "API" }],
        },
      ],
    });
    expect(
      validateClarifyRespondInput(payload, {
        conversationId: "c1",
        outcome: "answered",
        answers: {},
      }),
    ).toMatch(/请完成澄清题/);
  });

  it("schema rejects answered without answers or notes", () => {
    expect(() =>
      CoachClarifyRespondSchema.parse({
        conversationId: "c1",
        outcome: "answered",
      }),
    ).toThrow();
  });
});

describe("formatClarifyAnswersForPrompt", () => {
  it("formats selected option labels", () => {
    const payload = CoachClarifyPayloadSchema.parse({
      questions: [
        {
          id: "scope",
          prompt: "范围？",
          options: [
            { id: "api", label: "仅后端 API" },
            { id: "full", label: "全栈" },
          ],
        },
      ],
    });
    const text = formatClarifyAnswersForPrompt(payload, { scope: "api" });
    expect(text).toContain("范围？");
    expect(text).toContain("仅后端 API");
  });

  it("includes annotation-only answers", () => {
    const payload = CoachClarifyPayloadSchema.parse({
      questions: [{ id: "notes", prompt: "补充说明", allowFreeform: true }],
    });
    const text = formatClarifyAnswersForPrompt(
      payload,
      {},
      { notes: { notes: "只要 JWT" } },
    );
    expect(text).toContain("补充说明");
    expect(text).toContain("只要 JWT");
  });
});

describe("coachRecordsToChatTurns clarify", () => {
  it("serializes clarify and tool_result", () => {
    const turns = coachRecordsToChatTurns([
      {
        id: 1,
        conversationId: "c1",
        kind: "clarify",
        timestamp: "t1",
        clarify: {
          title: "确认",
          questions: [{ id: "q1", prompt: "选架构" }],
          status: "pending",
        },
      },
      {
        id: 2,
        conversationId: "c1",
        kind: "tool_result",
        timestamp: "t2",
        toolResult: {
          toolName: CLARIFY_TOOL_NAME,
          clarifyMessageId: 1,
          outcome: "answered",
          answers: { q1: "monolith" },
        },
      },
    ]);
    expect(turns[0]?.toolName).toBe(CLARIFY_TOOL_NAME);
    expect(turns[0]?.text).toContain(CLARIFY_TOOL_NAME);
    expect(turns[1]?.role).toBe("tool_result");
    expect(turns[1]?.text).toContain("monolith");
  });

  it("still formats work order tool results", () => {
    const turns = coachRecordsToChatTurns([
      {
        id: 3,
        conversationId: "c1",
        kind: "tool_result",
        timestamp: "t3",
        toolResult: {
          toolName: WORK_ORDER_TOOL_NAME,
          refinedMessageId: 9,
          outcome: "confirmed",
          title: "登录页",
        },
      },
    ]);
    expect(turns[0]?.toolName).toBe(WORK_ORDER_TOOL_NAME);
  });
});
