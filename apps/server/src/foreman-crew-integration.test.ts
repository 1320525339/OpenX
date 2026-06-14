import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  formatCrewQuestionBlock,
  isCrewDirective,
} from "@openx/shared";
import { runCrewDialogueLoop } from "@openx/executor-core";
import {
  resetDb,
  insertGoal,
  insertProject,
  insertConversation,
  listCrewExchanges,
  listCoachMessages,
} from "./db.js";
import { handleCrewQuestion } from "./foreman-loop.js";
import {
  persistCrewQuestion,
  persistForemanDirective,
} from "./crew-persist.js";
import type { Goal } from "@openx/shared";

function seedGoal(): Goal {
  const now = new Date().toISOString();
  const suffix = `${Date.now()}`;
  const projectId = `p-crew-e2e-${suffix}`;
  const conversationId = `conv-crew-e2e-${suffix}`;
  insertProject({
    id: projectId,
    name: "crew-e2e",
    workspaceDir: process.cwd(),
    createdAt: now,
  });
  insertConversation({
    id: conversationId,
    projectId,
    title: "工头小游戏 E2E",
    createdAt: now,
    updatedAt: now,
  });
  const goal: Goal = {
    id: `g-crew-e2e-${suffix}`,
    conversationId,
    title: "生成浏览器小游戏",
    acceptance: "完成工头选型并实现游戏",
    executionPrompt: "小游戏 A/B 选型后实现",
    constraints: [],
    executorId: "acp:claude",
    status: "running",
    progress: 0,
    foremanThreadId: conversationId,
    createdAt: now,
    updatedAt: now,
  };
  insertGoal(goal);
  return goal;
}

/** 模拟 Claude 施工队：先问工头游戏类型，收到指令后「实现」打砖块 */
describe("foreman crew game integration", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
    resetDb();
    process.env.OPENX_FOREMAN_RULES_ONLY = "1";
  });

  afterEach(() => {
    resetDb();
    delete process.env.OPENX_DB_PATH;
    delete process.env.OPENX_FOREMAN_RULES_ONLY;
  });

  it("crew-question → foreman picks B → persist → steer 续跑完成", async () => {
    const goal = seedGoal();
    const gameQuestion = {
      kind: "question" as const,
      prompt: "请选择要实现的浏览器小游戏类型",
      options: [
        { id: "a", label: "方案A：贪吃蛇" },
        { id: "b", label: "方案B：打砖块" },
      ],
    };

    const ctx = {
      goal,
      callbacks: {
        onLog: vi.fn(),
        onCrewQuestion: vi.fn(async (question) => {
          persistCrewQuestion(goal.id, question);
          const outcome = await handleCrewQuestion({ goal, question });
          if (!isCrewDirective(outcome)) throw new Error("expected directive");
          const directive = {
            ...outcome,
            message: "选方案B（打砖块），先做可玩原型。",
            selectedOptionId: "b",
          };
          persistForemanDirective(goal.id, directive);
          return directive;
        }),
      },
    };

    const runTurn = vi.fn(async (_s, promptText, _c, opts) => {
      if (runTurn.mock.calls.length === 1) {
        return {
          summary: "待工头决策",
          assistantText: formatCrewQuestionBlock(gameQuestion),
          park: false,
          toolBudgetExceeded: false,
          deliverables: [],
        };
      }
      expect(opts?.steer).toBe(true);
      expect(promptText).toContain("【工头】");
      expect(promptText).toContain("打砖块");
      return {
        summary: "已按方案B完成打砖块小游戏（e2e-crew-game/index.html）",
        assistantText: "游戏已实现，可直接在浏览器打开。",
        park: true,
        toolBudgetExceeded: false,
        deliverables: [],
      };
    });

    const result = await runCrewDialogueLoop({}, "派单：生成小游戏", ctx as never, runTurn);

    expect(runTurn).toHaveBeenCalledTimes(2);
    expect(result.crewRounds).toBe(1);
    expect(result.summary).toContain("打砖块");

    const crew = listCrewExchanges(goal.id);
    expect(crew).toHaveLength(2);
    expect(crew[0]?.direction).toBe("crew_to_foreman");
    expect(crew[0]?.summary).toContain("小游戏");
    expect(crew[1]?.direction).toBe("foreman_to_crew");
    expect(crew[1]?.payload).toMatchObject({ message: expect.stringContaining("打砖块") });

    const coachTexts = listCoachMessages(goal.conversationId)
      .filter((m) => m.kind === "text")
      .map((m) => (m.kind === "text" ? m.text : ""));
    expect(coachTexts.some((t) => t.includes("施工队 → 工头"))).toBe(true);
    expect(coachTexts.some((t) => t.includes("工头 → 施工队"))).toBe(true);
  });
});
