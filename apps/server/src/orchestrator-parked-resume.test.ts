import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerExecutor, type ExecutorAdapter } from "@openx/executor-core";
import type { Goal } from "@openx/shared";
import {
  getGoalById,
  insertConversation,
  insertGoal,
  insertProject,
  listCrewExchanges,
  listLogs,
  listRunEventRecords,
  resetDb,
  updateGoalCrewBinding,
} from "./db.js";
import {
  detectExecutors,
  dispatchGoal,
  findAwaitingUserGoal,
  findPausedGoal,
  resetOrchestrator,
  resumeCrewAfterUserDecision,
} from "./orchestrator.js";
import { isRunActive, resetRunService } from "./run-service.js";
import { parkGoalAsPaused } from "./goal-lifecycle.js";

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

  it("onParkAwaitingUser 将 Goal 置为 paused 并以 paused 结束 run", async () => {
    const goal = seedRunningGoal(`${Date.now()}`);
    await dispatchGoal(goal.id);

    await waitFor(() => getGoalById(goal.id)?.status === "paused");

    const updated = getGoalById(goal.id);
    expect(updated?.status).toBe("paused");
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
    await waitFor(() => getGoalById(goal.id)?.status === "paused");

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

  it("dispatchGoal 跳过 paused 任务", async () => {
    const goal = seedRunningGoal(`${Date.now()}`);
    parkGoalAsPaused(goal.id, "测试暂停");

    await dispatchGoal(goal.id);

    const logs = listLogs(goal.id).map((l) => l.message);
    expect(logs.some((m) => m.includes("暂停等待开发商") || m.includes("等待开发商决策"))).toBe(
      true,
    );
    expect(isRunActive(goal.id)).toBe(false);
  });

  it("resumeCrewAfterUserDecision 在不支持 steer 时保持 paused", async () => {
    const goal = seedRunningGoal(`${Date.now()}`);
    parkGoalAsPaused(goal.id, "等待决策");
    updateGoalCrewBinding(goal.id, {
      crewStatus: "awaiting_user",
      crewSessionId: "crew-session-park",
    });

    registerExecutor({
      id: "pi",
      displayName: "Pi no steer",
      async detect() {
        return { available: true };
      },
      async run() {},
    });

    const resumed = await resumeCrewAfterUserDecision(goal.id, "选方案 B");
    expect(resumed.ok).toBe(false);
    expect(getGoalById(goal.id)?.status).toBe("paused");
    expect(getGoalById(goal.id)?.crewStatus).toBe("awaiting_user");
  });

  it("findPausedGoal 需 preferredGoalId；多暂停时不猜最后一个", () => {
    const suffix = `${Date.now()}`;
    const now = new Date().toISOString();
    const conversationId = `conv-multi-${suffix}`;
    insertProject({
      id: `p-multi-${suffix}`,
      name: "multi",
      workspaceDir: process.cwd(),
      createdAt: now,
    });
    insertConversation({
      id: conversationId,
      projectId: `p-multi-${suffix}`,
      title: "多暂停",
      createdAt: now,
      updatedAt: now,
    });
    const make = (id: string): Goal => ({
      id,
      conversationId,
      title: id,
      acceptance: "a",
      executionPrompt: "a",
      constraints: [],
      executorId: "pi",
      status: "running",
      progress: 10,
      createdAt: now,
      updatedAt: now,
    });
    insertGoal(make(`g-a-${suffix}`));
    insertGoal(make(`g-b-${suffix}`));
    parkGoalAsPaused(`g-a-${suffix}`);
    parkGoalAsPaused(`g-b-${suffix}`);

    expect(findPausedGoal(conversationId, `g-a-${suffix}`)?.id).toBe(`g-a-${suffix}`);
    expect(findPausedGoal(conversationId)).toBeUndefined();
    expect(findAwaitingUserGoal(conversationId, `g-a-${suffix}`)?.id).toBe(
      `g-a-${suffix}`,
    );
  });

  it("连续两次开发商续跑均注入指令且不丢", async () => {
    let steerCount = 0;
    const prompts: string[] = [];
    registerExecutor({
      id: "pi",
      displayName: "Pi multi-steer",
      async detect() {
        return { available: true };
      },
      async run(ctx) {
        await ctx.callbacks.onCrewSession?.("crew-session-multi");
        await ctx.callbacks.onParkAwaitingUser?.("等待开发商");
      },
      async steerRework(ctx) {
        steerCount += 1;
        prompts.push(ctx.crewContinuationPrompt ?? "");
        if (steerCount === 1) {
          await ctx.callbacks.onParkAwaitingUser?.("仍需确认");
          return true;
        }
        await ctx.callbacks.onComplete("第二次续跑完成");
        return true;
      },
      cancel() {},
    });

    const goal = seedRunningGoal(`multi-steer-${Date.now()}`);
    await dispatchGoal(goal.id);
    await waitFor(() => getGoalById(goal.id)?.status === "paused");

    const first = await resumeCrewAfterUserDecision(goal.id, "第一次：选方案A");
    expect(first.ok).toBe(true);
    await waitFor(() => getGoalById(goal.id)?.status === "paused");

    const second = await resumeCrewAfterUserDecision(goal.id, "第二次：改选方案B");
    expect(second.ok).toBe(true);
    await waitFor(() => getGoalById(goal.id)?.status === "awaiting_review");

    expect(steerCount).toBe(2);
    expect(prompts[0]).toContain("第一次：选方案A");
    expect(prompts[1]).toContain("第二次：改选方案B");
    const crew = listCrewExchanges(goal.id);
    expect(
      crew.some((r) => r.summary.includes("第一次") || r.summary.includes("方案A")),
    ).toBe(true);
    expect(
      crew.some((r) => r.summary.includes("第二次") || r.summary.includes("方案B")),
    ).toBe(true);
  });
});
