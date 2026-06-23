import { describe, expect, it, vi } from "vitest";
import {
  formatCrewQuestionBlock,
  resolveForemanDirectiveAuto,
  isCrewDirective,
} from "@openx/shared";
import type { ExecutorContext } from "./index.js";
import {
  runCrewDialogueLoop,
  runForemanManagedLoop,
  dispositionForemanManagedLoop,
  MAX_CREW_DIALOGUE_ROUNDS,
  MAX_FOREMAN_LOOP_ROUNDS,
} from "./crew-loop.js";

const goal = {
  id: "g1",
  title: "登录页",
  conversationId: "conv-1",
  foremanThreadId: "conv-1",
  acceptance: "单元测试通过",
  executionPrompt: "实现登录",
  constraints: [] as string[],
};

describe("runCrewDialogueLoop", () => {
  it("parses crew-question, asks real foreman, steers with option B directive", async () => {
    const session = {};
    const abQuestion = {
      kind: "question" as const,
      prompt: "请选择实现方案",
      options: [
        { id: "a", label: "方案A" },
        { id: "b", label: "方案B" },
      ],
    };

    const receivedQuestions: typeof abQuestion[] = [];
    const ctx = {
      goal,
      callbacks: {
        onLog: vi.fn(),
        onCrewQuestion: vi.fn(async (question) => {
          receivedQuestions.push(question);
          const outcome = resolveForemanDirectiveAuto({ goal, question });
          if (!isCrewDirective(outcome)) {
            throw new Error("expected directive");
          }
          return {
            ...outcome,
            message: "选方案B（打砖块），先做可玩原型。",
          };
        }),
      },
    } as unknown as ExecutorContext;

    const runTurn = vi.fn(async (_s, promptText, _c, opts) => {
      if (runTurn.mock.calls.length === 1) {
        expect(opts?.steer).toBeUndefined();
        return {
          summary: "pending",
          assistantText: `分析中…\n${formatCrewQuestionBlock(abQuestion)}`,
          park: false,
          toolBudgetExceeded: false,
          deliverables: [],
        };
      }
      expect(opts?.steer).toBe(true);
      expect(promptText).toContain("【工头】");
      expect(promptText).toContain("方案B");
      return {
        summary: "已按方案B完成",
        assistantText: "实现完毕",
        park: true,
        toolBudgetExceeded: false,
        deliverables: [],
      };
    });

    const result = await runCrewDialogueLoop(session, "初始派单", ctx, runTurn);

    expect(runTurn).toHaveBeenCalledTimes(2);
    expect(receivedQuestions).toHaveLength(1);
    expect(receivedQuestions[0]?.options?.[1]?.id).toBe("b");
    expect(ctx.callbacks.onCrewQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "请选择实现方案" }),
    );
    expect(result.crewRounds).toBe(1);
    expect(result.summary).toBe("已按方案B完成");
    expect(result.park).toBe(true);
  });

  it("pauses loop when foreman returns pauseUntilUser", async () => {
    const runTurn = vi.fn(async () => ({
      summary: "方案已列出",
      assistantText: "【请示工头】\n是否停服清空？",
      park: true,
      toolBudgetExceeded: false,
      deliverables: [],
    }));
    const ctx = {
      goal,
      callbacks: {
        onLog: vi.fn(),
        onCrewQuestion: vi.fn(async () => ({
          kind: "directive" as const,
          message: "请暂停，等待开发商",
          source: "foreman_rule" as const,
          pauseUntilUser: true,
        })),
      },
    } as unknown as ExecutorContext;

    const result = await runCrewDialogueLoop({}, "任务", ctx, runTurn);
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(result.awaitingUser).toBe(true);
    expect(result.crewRounds).toBe(1);
  });

  it("stops after first turn when no crew-question and no turn review", async () => {
    const runTurn = vi.fn(async () => ({
      summary: "直接完成",
      assistantText: "无需工头决策",
      park: true,
      toolBudgetExceeded: false,
      deliverables: [],
    }));
    const onCrewQuestion = vi.fn();
    const ctx = {
      goal,
      callbacks: { onLog: vi.fn(), onCrewQuestion },
    } as unknown as ExecutorContext;

    const result = await runCrewDialogueLoop({}, "任务", ctx, runTurn);
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(onCrewQuestion).not.toHaveBeenCalled();
    expect(result.crewRounds).toBe(0);
    expect(result.submitForReview).toBe(true);
    expect(result.dialogueExhausted).toBe(false);
  });

  it("continues when foreman turn review returns continue", async () => {
    const runTurn = vi.fn(async (_s, promptText, _c, opts) => {
      if (runTurn.mock.calls.length === 1) {
        return {
          summary: "进行中",
          assistantText: "已搭骨架",
          park: false,
          toolBudgetExceeded: false,
          deliverables: [],
        };
      }
      expect(opts?.steer).toBe(true);
      expect(promptText).toContain("【工头】");
      return {
        summary: "已完成",
        assistantText: "实现完毕",
        park: true,
        toolBudgetExceeded: false,
        deliverables: [{ kind: "file", path: "game.html" }],
      };
    });
    const onCrewTurnReview = vi.fn(async () => {
      if (onCrewTurnReview.mock.calls.length === 1) {
        return {
          action: "continue" as const,
          message: "继续完善可玩性",
          source: "foreman_llm" as const,
        };
      }
      return {
        action: "submit_for_review" as const,
        message: "可交差",
        source: "foreman_llm" as const,
      };
    });
    const ctx = {
      goal,
      callbacks: { onLog: vi.fn(), onCrewTurnReview },
    } as unknown as ExecutorContext;

    const result = await runForemanManagedLoop({}, "任务", ctx, runTurn);
    expect(runTurn).toHaveBeenCalledTimes(2);
    expect(onCrewTurnReview).toHaveBeenCalledTimes(2);
    expect(result.submitForReview).toBe(true);
    expect(result.foremanRounds).toBe(2);
  });

  it("parks when foreman turn review returns ask_user", async () => {
    const runTurn = vi.fn(async () => ({
      summary: "方案已列出",
      assistantText: "方案 A，确认后执行",
      park: true,
      toolBudgetExceeded: false,
      deliverables: [],
    }));
    const ctx = {
      goal,
      callbacks: {
        onLog: vi.fn(),
        onCrewTurnReview: vi.fn(async () => ({
          action: "ask_user" as const,
          message: "需开发商确认",
          source: "foreman_llm" as const,
        })),
      },
    } as unknown as ExecutorContext;

    const result = await runForemanManagedLoop({}, "任务", ctx, runTurn);
    expect(result.awaitingUser).toBe(true);
    expect(result.foremanRounds).toBe(1);
  });

  it("exhausts foreman loop when foreman keeps returning continue", async () => {
    const runTurn = vi.fn(async () => ({
      summary: "pending",
      assistantText: "还在施工",
      park: false,
      toolBudgetExceeded: false,
      deliverables: [],
    }));
    const ctx = {
      goal,
      callbacks: {
        onLog: vi.fn(),
        onCrewTurnReview: vi.fn(async () => ({
          action: "continue" as const,
          message: "继续",
          source: "foreman_rule" as const,
        })),
      },
    } as unknown as ExecutorContext;

    const result = await runForemanManagedLoop({}, "任务", ctx, runTurn);
    expect(runTurn).toHaveBeenCalledTimes(MAX_FOREMAN_LOOP_ROUNDS);
    expect(result.dialogueExhausted).toBe(true);
    expect(dispositionForemanManagedLoop(result).action).toBe("dialogue_exhausted");
  });

  it("does not complete without foreman submit_for_review when turn review is wired", async () => {
    const runTurn = vi.fn(async () => ({
      summary: "直接完成",
      assistantText: "做完了",
      park: true,
      toolBudgetExceeded: false,
      deliverables: [],
    }));
    const ctx = {
      goal,
      callbacks: {
        onLog: vi.fn(),
        onCrewTurnReview: vi.fn(async () => ({
          action: "continue" as const,
          message: "还不够",
          source: "foreman_rule" as const,
        })),
      },
    } as unknown as ExecutorContext;

    const result = await runForemanManagedLoop({}, "任务", ctx, runTurn);
    expect(result.submitForReview).toBeUndefined();
    expect(dispositionForemanManagedLoop(result).action).toBe("dialogue_exhausted");
  });

  it("stops after first turn when no crew-question in output (legacy alias)", async () => {
    const runTurn = vi.fn(async () => ({
      summary: "直接完成",
      assistantText: "无需工头决策",
      park: true,
      toolBudgetExceeded: false,
      deliverables: [],
    }));
    const onCrewQuestion = vi.fn();
    const ctx = {
      goal,
      callbacks: { onLog: vi.fn(), onCrewQuestion },
    } as unknown as ExecutorContext;

    const result = await runCrewDialogueLoop({}, "任务", ctx, runTurn);
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(onCrewQuestion).not.toHaveBeenCalled();
    expect(result.crewRounds).toBe(0);
    expect(result.submitForReview).toBe(true);
  });

  it("sets dialogueExhausted=true when crew keeps asking until max rounds", async () => {
    const question = {
      kind: "question" as const,
      prompt: "请确认细节",
      options: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
    };
    // 每轮都提问，迫使循环耗尽
    const runTurn = vi.fn(async () => ({
      summary: "pending",
      assistantText: `继续提问\n${formatCrewQuestionBlock(question)}`,
      park: false,
      toolBudgetExceeded: false,
      deliverables: [],
    }));
    const ctx = {
      goal,
      callbacks: {
        onLog: vi.fn(),
        onCrewQuestion: vi.fn(async () => ({
          kind: "directive" as const,
          message: "继续推进",
          source: "foreman_rule" as const,
        })),
      },
    } as unknown as ExecutorContext;

    const result = await runCrewDialogueLoop({}, "任务", ctx, runTurn);
    expect(runTurn).toHaveBeenCalledTimes(MAX_CREW_DIALOGUE_ROUNDS);
    expect(result.dialogueExhausted).toBe(true);
    expect(result.crewRounds).toBe(MAX_CREW_DIALOGUE_ROUNDS);
    expect(result.toolBudgetExceeded).toBe(false);
  });
});
