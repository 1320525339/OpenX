import { describe, expect, it } from "vitest";
import { findDismissedRefinedRecordIds } from "./coach-thread.js";

describe("findDismissedRefinedRecordIds", () => {
  it("marks refined as dismissed after tool_result", () => {
    const records = [
      {
        id: 1,
        conversationId: "c1",
        kind: "refined" as const,
        timestamp: "t1",
        refined: {
          title: "登录页",
          acceptance: "可登录",
          executionPrompt: "做登录",
          constraints: [],
        },
      },
      {
        id: 2,
        conversationId: "c1",
        kind: "tool_result" as const,
        timestamp: "t2",
        toolResult: {
          toolName: "propose_work_order" as const,
          refinedMessageId: 1,
          outcome: "dismissed" as const,
          title: "登录页",
          dismissed: true,
        },
      },
    ];
    expect(findDismissedRefinedRecordIds(records)).toEqual(new Set([1]));
  });

  it("marks refined as dismissed after legacy cancel user message", () => {
    const records = [
      {
        id: 1,
        conversationId: "c1",
        kind: "refined" as const,
        timestamp: "t1",
        refined: {
          title: "登录页",
          acceptance: "可登录",
          executionPrompt: "做登录",
          constraints: [],
        },
      },
      {
        id: 2,
        conversationId: "c1",
        kind: "text" as const,
        role: "user" as const,
        text: "我先不创建「登录页」这个任务单了",
        timestamp: "t2",
      },
      {
        id: 3,
        conversationId: "c1",
        kind: "text" as const,
        role: "coach" as const,
        text: "好的，有需要再说。",
        timestamp: "t3",
      },
    ];
    expect(findDismissedRefinedRecordIds(records)).toEqual(new Set([1]));
  });

  it("ignores linked refined records", () => {
    const records = [
      {
        id: 1,
        conversationId: "c1",
        kind: "refined" as const,
        timestamp: "t1",
        refined: {
          title: "A",
          acceptance: "ok",
          executionPrompt: "do",
          constraints: [],
        },
        linkedGoalId: "g1",
      },
      {
        id: 2,
        conversationId: "c1",
        kind: "text" as const,
        role: "user" as const,
        text: "我先不创建「A」这个任务单了",
        timestamp: "t2",
      },
    ];
    expect(findDismissedRefinedRecordIds(records)).toEqual(new Set());
  });
});
