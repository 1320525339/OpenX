import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Goal } from "@openx/shared";
import { DEFAULT_PI_MAX_TOOL_CALLS } from "@openx/shared";
import { insertGoal, resetDb } from "./db.js";
import { runPiWatchdogOnce } from "./pi-watchdog.js";
import { loadSettings } from "./settings-store.js";
import {
  seedTestProjectAndConversation,
  TEST_CONVERSATION_ID,
} from "./test-helpers.js";

function makeRunningPiGoal(id: string, progress = 92): Goal {
  const now = new Date().toISOString();
  return {
    id,
    conversationId: TEST_CONVERSATION_ID,
    title: "Pi 死循环测试",
    acceptance: "完成",
    executionPrompt: "test",
    constraints: [],
    executorId: "pi",
    status: "running",
    progress,
    dependsOn: [],
    priority: "medium",
    createdAt: now,
    updatedAt: now,
  };
}

describe("pi-watchdog", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    process.env.OPENX_MOCK_PI = "1";
    resetDb();
    seedTestProjectAndConversation();
  });

  afterEach(() => {
    resetDb();
    delete process.env.OPENX_DB_PATH;
    delete process.env.OPENX_MOCK_PI;
  });

  it("terminates pi goal with excessive tool logs", async () => {
    const goal = makeRunningPiGoal("pi-stuck");
    insertGoal(goal);
    const { appendLog, getGoalById } = await import("./db.js");
    // 与 pi-watchdog 的阈值公式保持一致，避免依赖本机 settings/默认值
    const settings = loadSettings();
    const maxTools =
      settings.executors.pi?.maxToolCalls ??
      Number.parseInt(
        process.env.OPENX_PI_MAX_TOOLS ?? String(DEFAULT_PI_MAX_TOOL_CALLS),
        10,
      );
    const ceiling = Math.max(maxTools + 2, 14);
    for (let i = 1; i <= ceiling + 1; i++) {
      appendLog(goal.id, "info", `[pi] 工具 #${i}：bash {"command":"test"}`);
    }

    runPiWatchdogOnce();

    const updated = getGoalById(goal.id);
    expect(updated?.status).toBe("failed");
  });
});
