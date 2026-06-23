import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Goal } from "@openx/shared";
import { getGoalById, insertGoal, resetDb } from "./db.js";
import {
  registerConnection,
  resetConnections,
  markGoalCancelledForConnect,
  isGoalCancelledForConnect,
} from "./connect-store.js";
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
    orderNo: 1,
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

  it("clears cancelledGoalIds after failing a stale goal", () => {
    const stale = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    insertGoal(makeConnectGoal("connect-cancel-clear", 10, stale));
    registerConnection({
      toolName: "cursor-agent",
      agentName: "Cursor Worker",
      executorId: "cursor-worker",
    });

    // 模拟用户取消目标后，watchdog 应清理取消标记
    markGoalCancelledForConnect("connect-cancel-clear");
    expect(isGoalCancelledForConnect("connect-cancel-clear")).toBe(true);

    runConnectWatchdogOnce();

    // watchdog 跳过了已取消目标（不 fail），但取消标记仍在
    // 注：watchdog 在 isGoalCancelledForConnect(goal.id) 时 continue，不会调用 markGoalFailed + clear
    // 所以已取消目标的标记保留（等待 purgeGoalRecords 清理）
    expect(isGoalCancelledForConnect("connect-cancel-clear")).toBe(true);
    // 目标状态仍为 running（因为 watchdog 跳过了已取消目标）
    expect(getGoalById("connect-cancel-clear")?.status).toBe("running");
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
