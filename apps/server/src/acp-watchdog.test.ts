import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Goal } from "@openx/shared";
import { insertGoal, resetDb } from "./db.js";
import { runAcpWatchdogOnce } from "./acp-watchdog.js";
import {
  seedTestProjectAndConversation,
  TEST_CONVERSATION_ID,
} from "./test-helpers.js";

function makeRunningAcpGoal(id: string, progress = 90): Goal {
  const now = new Date().toISOString();
  return {
    id,
    conversationId: TEST_CONVERSATION_ID,
    title: "ACP 死循环测试",
    acceptance: "完成",
    executionPrompt: "test",
    constraints: [],
    executorId: "acp:gemini",
    status: "running",
    progress,
    dependsOn: [],
    priority: "medium",
    createdAt: now,
    updatedAt: now,
  };
}

describe("acp-watchdog", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
    seedTestProjectAndConversation();
  });

  afterEach(() => {
    resetDb();
    delete process.env.OPENX_DB_PATH;
  });

  it("terminates acp goal with excessive tool logs", async () => {
    const goal = makeRunningAcpGoal("acp-stuck");
    insertGoal(goal);
    const { appendLog, getGoalById } = await import("./db.js");
    for (let i = 1; i <= 15; i++) {
      appendLog(goal.id, "info", `[acp:gemini] 工具 #${i}：bash`);
    }

    runAcpWatchdogOnce();

    const updated = getGoalById(goal.id);
    expect(updated?.status).toBe("failed");
  });
});
