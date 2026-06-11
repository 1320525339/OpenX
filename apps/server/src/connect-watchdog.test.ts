import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Goal } from "@openx/shared";
import { getGoalById, insertGoal, resetDb } from "./db.js";
import { registerConnection, resetConnections } from "./connect-store.js";
import { runConnectWatchdogOnce } from "./connect-watchdog.js";
import {
  seedTestProjectAndConversation,
  TEST_CONVERSATION_ID,
} from "./test-helpers.js";

function makeConnectGoal(id: string, progress = 10, updatedAt?: string): Goal {
  const now = updatedAt ?? new Date().toISOString();
  return {
    id,
    conversationId: TEST_CONVERSATION_ID,
    title: "Connect 派发测试",
    acceptance: "完成",
    executionPrompt: "test",
    constraints: [],
    executorId: "cursor-worker",
    status: "running",
    progress,
    dependsOn: [],
    priority: "medium",
    createdAt: now,
    updatedAt: now,
  };
}

describe("connect-watchdog", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
    seedTestProjectAndConversation();
    resetConnections();
  });

  afterEach(() => {
    resetDb();
    resetConnections();
    delete process.env.OPENX_DB_PATH;
  });

  it("fails connect goal not picked up within dispatch timeout", () => {
    const stale = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    insertGoal(makeConnectGoal("connect-stale", 10, stale));
    registerConnection({
      toolName: "cursor-agent",
      agentName: "Cursor Worker",
      executorId: "cursor-worker",
    });

    runConnectWatchdogOnce();

    const updated = getGoalById("connect-stale");
    expect(updated?.status).toBe("failed");
  });

  it("does not fail connect goal picked up with progress above dispatch threshold", () => {
    const stale = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    insertGoal(makeConnectGoal("connect-active", 15, stale));
    registerConnection({
      toolName: "cursor-agent",
      agentName: "Cursor Worker",
      executorId: "cursor-worker",
    });

    runConnectWatchdogOnce();

    expect(getGoalById("connect-active")?.status).toBe("running");
  });
});
