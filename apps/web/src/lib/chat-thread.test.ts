import { describe, expect, it } from "vitest";
import { createEmptyRunState } from "@openx/shared";
import type { CoachMessageRecord } from "@openx/shared";
import {
  appendExecutionRecord,
  coachRecordsToThreadItems,
  findActiveRefinedRecordId,
  findLatestPendingRefinedRecord,
  pickLiveExecution,
  refinedRecordMatchesPreview,
} from "./chat-thread";

describe("chat-thread", () => {
  it("maps persisted records to thread items", () => {
    const records: CoachMessageRecord[] = [
      {
        id: 1,
        conversationId: "c1",
        kind: "text",
        role: "user",
        text: "hi",
        timestamp: "t1",
      },
      {
        id: 2,
        conversationId: "c1",
        kind: "execution",
        timestamp: "t2",
        execution: {
          goalId: "g1",
          goalTitle: "Task",
          goalStatus: "done",
          runId: "r1",
          run: createEmptyRunState("g1"),
        },
      },
    ];
    const items = coachRecordsToThreadItems(records);
    expect(items).toHaveLength(2);
    expect(items[0]?.kind).toBe("message");
    expect(items[1]?.kind).toBe("execution");
  });

  it("dedupes execution records by id", () => {
    const execution = {
      id: 9,
      conversationId: "c1",
      kind: "execution" as const,
      timestamp: "t",
      execution: {
        goalId: "g1",
        goalTitle: "Task",
        goalStatus: "done" as const,
        runId: "r1",
        run: createEmptyRunState("g1"),
      },
    };
    const next = appendExecutionRecord([], execution);
    expect(appendExecutionRecord(next, execution)).toHaveLength(1);
  });

  it("skips refined records dismissed by tool_result", () => {
    const records: CoachMessageRecord[] = [
      {
        id: 5,
        conversationId: "c1",
        kind: "refined",
        timestamp: "t",
        refined: {
          title: "登录",
          acceptance: "ok",
          executionPrompt: "do",
          constraints: [],
        },
      },
      {
        id: 6,
        conversationId: "c1",
        kind: "tool_result",
        timestamp: "t2",
        toolResult: {
          toolName: "propose_work_order",
          refinedMessageId: 5,
          outcome: "dismissed",
          title: "登录",
        },
      },
    ];
    expect(findLatestPendingRefinedRecord(records)).toBeNull();
  });

  it("skips refined records already linked to goals", () => {
    const records: CoachMessageRecord[] = [
      {
        id: 10,
        conversationId: "c1",
        kind: "refined",
        timestamp: "t",
        refined: {
          title: "Build API",
          acceptance: "tests pass",
          executionPrompt: "do it",
          constraints: [],
        },
        linkedGoalId: "g-done",
      },
    ];
    expect(findLatestPendingRefinedRecord(records)).toBeNull();
  });

  it("matches refined preview to persisted record", () => {
    const refined = {
      title: "A",
      acceptance: "ok",
      executionPrompt: "do",
      constraints: [] as string[],
    };
    const record = {
      id: 3,
      conversationId: "c1",
      kind: "refined" as const,
      timestamp: "t",
      refined: { ...refined, title: "B" },
    };
    expect(refinedRecordMatchesPreview(record, refined)).toBe(false);
    expect(
      findActiveRefinedRecordId([record], refined),
    ).toBeNull();
    const match = { ...record, refined };
    expect(findActiveRefinedRecordId([match], refined)).toBe(3);
  });

  it("pickLiveExecution only returns active runs", () => {
    const goals = [
      {
        id: "g1",
        conversationId: "c1",
        status: "running" as const,
        title: "A",
      },
    ];
    const runs = {
      g1: { ...createEmptyRunState("g1"), active: true },
    };
    expect(pickLiveExecution(goals as never, runs)?.goal.id).toBe("g1");
    runs.g1.active = false;
    expect(pickLiveExecution(goals as never, runs)).toBeNull();
  });
});
