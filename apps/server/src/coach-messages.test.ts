import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { createEmptyRunState } from "@openx/shared";
import {
  hasCoachExecutionMessage,
  listCoachMessages,
  resetDb,
  saveCoachExecutionMessage,
  saveCoachMessage,
  insertProject,
  insertConversation,
} from "./db.js";

function seedConversation(id = "conv-a", projectId = `proj-${id}`) {
  const now = new Date().toISOString();
  insertProject({
    id: projectId,
    name: "Test",
    workspaceDir: process.cwd(),
    createdAt: now,
  });
  insertConversation({
    id,
    projectId,
    title: "对话A",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

describe("coach messages scope", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
  });

  afterEach(() => {
    resetDb();
    delete process.env.OPENX_DB_PATH;
  });

  it("conversation thread only includes its own messages", () => {
    const convA = seedConversation("conv-a");
    const convB = seedConversation("conv-b");
    saveCoachMessage(convA, "user", "A你好");
    saveCoachMessage(convA, "coach", "A回复");
    saveCoachMessage(convB, "user", "B不应出现");

    const msgs = listCoachMessages(convA);
    expect(msgs.map((m) => (m.kind === "text" ? m.text : m.kind))).toEqual([
      "A你好",
      "A回复",
    ]);
  });

  it("different conversations are isolated", () => {
    const convA = seedConversation("conv-a", "proj-a");
    const now = new Date().toISOString();
    insertConversation({
      id: "conv-b",
      projectId: "proj-a",
      title: "对话B",
      createdAt: now,
      updatedAt: now,
    });
    saveCoachMessage(convA, "user", "仅A");
    saveCoachMessage("conv-b", "user", "仅B");

    expect(
      listCoachMessages(convA)
        .filter((m) => m.kind === "text")
        .map((m) => m.text),
    ).toEqual(["仅A"]);
    expect(
      listCoachMessages("conv-b")
        .filter((m) => m.kind === "text")
        .map((m) => m.text),
    ).toEqual(["仅B"]);
  });

  it("persists execution snapshot messages", () => {
    const convA = seedConversation("conv-a");
    const run = {
      ...createEmptyRunState("goal-1"),
      runId: "run-1",
      liveText: "done",
      events: [
        {
          type: "text.delta" as const,
          delta: "done",
          timestamp: "2026-06-08T00:00:00.000Z",
        },
      ],
    };
    saveCoachExecutionMessage(convA, {
      goalId: "goal-1",
      goalTitle: "任务A",
      goalStatus: "awaiting_review",
      runId: "run-1",
      run,
    });
    expect(hasCoachExecutionMessage(convA, "goal-1", "run-1")).toBe(true);
    const msgs = listCoachMessages(convA);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.kind).toBe("execution");
    if (msgs[0]?.kind === "execution") {
      expect(msgs[0].execution.goalTitle).toBe("任务A");
      expect(msgs[0].execution.run.liveText).toBe("done");
    }
  });
});
