import {
  formatCrewForemanReplyForPrompt,
  parseCrewMessageFromText,
  type GoalDeliverable,
} from "@openx/shared";
import type { ExecutorContext } from "./index.js";

export const MAX_CREW_DIALOGUE_ROUNDS = 8;

export type CrewTurnResult = {
  summary: string;
  assistantText: string;
  park: boolean;
  toolBudgetExceeded: boolean;
  deliverables: GoalDeliverable[];
};

export type CrewTurnRunner<TSession> = (
  session: TSession,
  promptText: string,
  ctx: ExecutorContext,
  opts?: { steer?: boolean },
) => Promise<CrewTurnResult>;

/** 单轮结束后若施工队向工头请示，工头回复并在同 session 续跑（支持多轮自然对话） */
export async function runCrewDialogueLoop<TSession>(
  session: TSession,
  initialPrompt: string,
  ctx: ExecutorContext,
  runTurn: CrewTurnRunner<TSession>,
  opts?: { initialSteer?: boolean; logTag?: string },
): Promise<{
  summary: string;
  park: boolean;
  toolBudgetExceeded: boolean;
  crewRounds: number;
  deliverables: GoalDeliverable[];
}> {
  const tag = opts?.logTag ?? "crew";
  let promptText = initialPrompt;
  let steer = opts?.initialSteer ?? false;
  let crewRounds = 0;
  let last: CrewTurnResult | undefined;

  for (let round = 0; round <= MAX_CREW_DIALOGUE_ROUNDS; round += 1) {
    last = await runTurn(session, promptText, ctx, steer ? { steer: true } : undefined);
    if (last.toolBudgetExceeded) {
      return {
        summary: last.summary,
        park: last.park,
        toolBudgetExceeded: true,
        crewRounds,
        deliverables: last.deliverables,
      };
    }

    const question = parseCrewMessageFromText(last.assistantText);
    if (!question || !ctx.callbacks.onCrewQuestion) {
      return {
        summary: last.summary,
        park: last.park,
        toolBudgetExceeded: false,
        crewRounds,
        deliverables: last.deliverables,
      };
    }

    crewRounds += 1;
    await ctx.callbacks.onLog(
      "info",
      `[${tag}] 施工队提问 › ${question.prompt.slice(0, 120)}`,
    );

    const directive = await ctx.callbacks.onCrewQuestion(question);
    promptText = formatCrewForemanReplyForPrompt(directive);
    steer = true;

    await ctx.callbacks.onLog(
      "info",
      `[${tag}] 工头指令 › ${directive.message.slice(0, 120)}`,
    );
  }

  return {
    summary: last?.summary ?? "",
    park: last?.park ?? false,
    toolBudgetExceeded: false,
    crewRounds,
    deliverables: last?.deliverables ?? [],
  };
}
