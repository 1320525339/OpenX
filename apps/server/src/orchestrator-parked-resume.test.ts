import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerExecutor, type ExecutorAdapter } from "@openx/executor-core";
import type { Goal } from "@openx/shared";
import {
  getGoalById,
  insertConversation,
  insertGoal,
  insertProject,
  listCrewExchanges,
  listRunEventRecords,
  resetDb,
  updateGoalCrewBinding,
} from "./db.js";
import {
  detectExecutors,
  dispatchGoal,
  findAwaitingUserGoal,
  resetOrchestrator,
  resumeCrewAfterUserDecision,
} from "./orchestrator.js";
import { isRunActive, resetRunService } from "./run-service.js";

function createParkPiExecutor(): ExecutorAdapter {
  return {
    id: "pi",
    displayName: "Pi Park Test",
    async detect() {
      return { available: true, hint: "orchestrator park/resume 集成测试" };
    },
    async run(ctx) {
      await ctx.callbacks.onCrewSession?.("crew-session-park");
      await ctx.callbacks.onParkAwaitingUser?.("工头提请开发商确认方案");
    },
    async steerRework(ctx) {
      await ctx.callbacks.onProgress(80, "续跑中");
      await ctx.callbacks.onComplete("按开发商决策完成续跑");
      return true;
    },
    cancel() {},
  };
}

function seedRunningGoal(suffix: string): Goal {
  const now = new Date().toISOString();
  const projectId = `p-park-${suffix}`;
  const conversationId = `conv-park-${suffix}`;
  insertProject({
    id: projectId,
    name: "park-test",
    workspaceDir: process.cwd(),
    createdAt: now,
  });
  insertConversation({
    id: conversationId,
    projectId,
    title: "工头暂停续跑",
    createdAt: now,
    updatedAt: now,
  });
  const goal: Goal = {
    id: `g-park-${suffix}`,
    conversationId,
    title: "浏览器小游戏",
    acceptance: "可玩原型",
    executionPrompt: "实现小游戏",
    constraints: [],
    executorId: "pi",
    status: "running",
    progress: 10,
    foremanThreadId: conversationId,
    createdAt: now,
    updatedAt: now,
  };
  insertGoal(goal);
  return goal;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3000,
  intervalMs = 20,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("waitFor timeout");
}

describe("orchestrator park and resume", () => {
  beforeEach(async () => {
    process.env.OPENX_DB_PATH = ":memory:";
    process.env.OPENX_MOCK_PI = "1";
    resetDb();
    resetOrchestrator();
    resetRunService();
    await detectExecutors();
    registerExecutor(createParkPiExecutor());
  });

  afterEach(() => {
    resetDb();
    resetRunService();
    resetOrchestrator();
    delete process.env.OPENX_DB_PATH;
    delete process.env.OPENX_MOCK_PI;
  });

  it("onParkAwaitingUser 以 paused 结束 run 并保持 running + awaiting_user", async () => {
    const goal = seedRunningGoal(`${Date.now()}`);
    await dispatchGoal(goal.id);

    await waitFor(() => getGoalById(goal.id)?.crewStatus === "awaiting_user");

    const updated = getGoalById(goal.id);
    expect(updated?.status).toBe("running");
    expect(updated?.crewStatus).toBe("awaiting_user");
    expect(updated?.crewSessionId).toBe("crew-session-park");
    expect(isRunActive(goal.id)).toBe(false);

    const runEvents = listRunEventRecords(goal.id);
    const end = runEvents.find((e) => e.type === "run.end");
    expect(end?.type).toBe("run.end");
    if (end?.type === "run.end") {
      expect(end.status).toBe("paused");
      expect(end.summary).toContain("开发商");
    }
  });

  it("resumeCrewAfterUserDecision 注入开发商回复并 steer 续跑完成", async () => {
    const goal = seedRunningGoal(`${Date.now()}`);
    await dispatchGoal(goal.id);
    await waitFor(() => getGoalById(goal.id)?.crewStatus === "awaiting_user");

    const resumed = await resumeCrewAfterUserDecision(goal.id, "选方案 B，先做打砖块");
    expect(resumed).toEqual({ ok: true });

    await waitFor(() => getGoalById(goal.id)?.status === "awaiting_review");

    const after = getGoalById(goal.id);
    expect(after?.crewStatus).toBe("idle");
    expect(after?.status).toBe("awaiting_review");
    expect(isRunActive(goal.id)).toBe(false);

    const crew = listCrewExchanges(goal.id);
    const userDirective = crew.find(
      (row) =>
        row.direction === "foreman_to_crew" &&
        row.summary.includes("开发商"),
    );
    expect(userDirective?.payload).toMatchObject({
      message: expect.stringContaining("选方案 B"),
    });
  });

  it("findAwaitingUserGoal 优先返回指定 goalId", () => {
    const suffix = `${Date.now()}`;
    const goalA = seedRunningGoal(`${suffix}-a`);
    const goalB = seedRunningGoal(`${suffix}-b`);
    updateGoalCrewBinding(goalA.id, { crewStatus: "awaiting_user" });
    updateGoalCrewBinding(goalB.id, { crewStatus: "awaiting_user" });

    expect(findAwaitingUserGoal(goalA.conversationId, goalA.id)?.id).toBe(goalA.id);
    expect(findAwaitingUserGoal(goalB.conversationId)?.id).toBe(goalB.id);
  });
});
