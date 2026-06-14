import { describe, expect, it, vi } from "vitest";
import {
  formatCrewQuestionBlock,
  resolveForemanDirectiveAuto,
  isCrewDirective,
} from "@openx/shared";
import type { ExecutorContext } from "./index.js";
import { runCrewDialogueLoop } from "./crew-loop.js";

const goal = {
  id: "g1",
  title: "登录页",
  conversationId: "conv-1",
  foremanThreadId: "conv-1",
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

  it("stops after first turn when no crew-question in output", async () => {
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
  });
});
