import { describe, expect, it } from "vitest";
import { createEmptyRunState } from "./run.js";
import {
  coachRecordsToChatTurns,
  findDismissedRefinedRecordIds,
} from "./coach-thread.js";

describe("coachRecordsToChatTurns", () => {
  it("skips execution and operator_action by default", () => {
    const records = [
      {
        id: 1,
        conversationId: "c1",
        kind: "text" as const,
        role: "user" as const,
        text: "你好",
        timestamp: "t1",
      },
      {
        id: 2,
        conversationId: "c1",
        kind: "execution" as const,
        timestamp: "t2",
        execution: {
          goalId: "g1",
          goalTitle: "登录页",
          goalStatus: "done" as const,
          runId: "r1",
          run: createEmptyRunState("g1"),
        },
      },
      {
        id: 3,
        conversationId: "c1",
        kind: "operator_action" as const,
        timestamp: "t3",
        operatorAction: {
          pendingActionId: "a1",
          method: "POST",
          path: "/api/goals",
          summary: "创建目标",
          status: "pending" as const,
        },
      },
    ];
    expect(coachRecordsToChatTurns(records)).toEqual([
      { role: "user", text: "你好" },
    ]);
  });

  it("includes execution and operator_action when requested", () => {
    const records = [
      {
        id: 1,
        conversationId: "c1",
        kind: "execution" as const,
        timestamp: "t1",
        execution: {
          goalId: "g1",
          goalTitle: "登录页",
          goalStatus: "awaiting_review" as const,
          runId: "r1",
          run: createEmptyRunState("g1"),
        },
      },
      {
        id: 2,
        conversationId: "c1",
        kind: "operator_action" as const,
        timestamp: "t2",
        operatorAction: {
          pendingActionId: "a1",
          method: "DELETE",
          path: "/api/goals/g1",
          summary: "删除目标",
          status: "pending" as const,
        },
      },
    ];
    expect(
      coachRecordsToChatTurns(records, {
        includeExecutionSnapshots: true,
        includeOperatorActions: true,
      }),
    ).toEqual([
      {
        role: "coach",
        text: "[执行快照] 登录页 · awaiting_review",
      },
      {
        role: "coach",
        text: "[操作待确认] 删除目标",
      },
    ]);
  });
});

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
