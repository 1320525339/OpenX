import {
  formatCrewForemanReplyForPrompt,
  foremanTurnDecisionToDirective,
  MAX_FOREMAN_LOOP_ROUNDS,
  parseCrewMessageFromText,
  type ForemanTurnDecision,
  type ForemanTurnReviewInput,
  type GoalDeliverable,
} from "@openx/shared";
import type { ExecutorContext } from "./index.js";

export { MAX_FOREMAN_LOOP_ROUNDS };

/** @deprecated 使用 MAX_FOREMAN_LOOP_ROUNDS */
export const MAX_CREW_DIALOGUE_ROUNDS = MAX_FOREMAN_LOOP_ROUNDS;

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

export type ForemanManagedLoopResult = {
  summary: string;
  park: boolean;
  toolBudgetExceeded: boolean;
  crewRounds: number;
  foremanRounds: number;
  deliverables: GoalDeliverable[];
  dialogueExhausted: boolean;
  awaitingUser?: boolean;
  submitForReview?: boolean;
  failed?: boolean;
  failureMessage?: string;
};

async function applyForemanTurnDecision(
  decision: ForemanTurnDecision,
  last: CrewTurnResult,
  state: {
    foremanRounds: number;
    crewRounds: number;
  },
): Promise<
  | { type: "continue"; promptText: string; steer: boolean; foremanRounds: number }
  | { type: "terminal"; result: ForemanManagedLoopResult }
> {
  switch (decision.action) {
    case "continue": {
      const directive = foremanTurnDecisionToDirective(decision);
      return {
        type: "continue",
        promptText: formatCrewForemanReplyForPrompt(directive),
        steer: true,
        foremanRounds: state.foremanRounds + 1,
      };
    }
    case "ask_user":
      return {
        type: "terminal",
        result: {
          summary: last.summary,
          park: last.park,
          toolBudgetExceeded: false,
          crewRounds: state.crewRounds,
          foremanRounds: state.foremanRounds + 1,
          deliverables: last.deliverables,
          dialogueExhausted: false,
          awaitingUser: true,
        },
      };
    case "submit_for_review":
      return {
        type: "terminal",
        result: {
          summary: last.summary,
          park: last.park,
          toolBudgetExceeded: false,
          crewRounds: state.crewRounds,
          foremanRounds: state.foremanRounds + 1,
          deliverables: last.deliverables,
          dialogueExhausted: false,
          submitForReview: true,
        },
      };
    case "fail":
      return {
        type: "terminal",
        result: {
          summary: last.summary,
          park: last.park,
          toolBudgetExceeded: false,
          crewRounds: state.crewRounds,
          foremanRounds: state.foremanRounds + 1,
          deliverables: last.deliverables,
          dialogueExhausted: false,
          failed: true,
          failureMessage: decision.message,
        },
      };
    default:
      return {
        type: "continue",
        promptText: formatCrewForemanReplyForPrompt(
          foremanTurnDecisionToDirective({
            action: "continue",
            message: decision.message,
            source: "foreman_rule",
          }),
        ),
        steer: true,
        foremanRounds: state.foremanRounds + 1,
      };
  }
}

export type ForemanManagedLoopDisposition =
  | { action: "tool_budget_exceeded" }
  | { action: "failed"; message: string }
  | { action: "dialogue_exhausted" }
  | { action: "awaiting_user" }
  | { action: "complete" };

/** 将工头编排循环结果映射为执行器收尾动作 */
export function dispositionForemanManagedLoop(
  result: ForemanManagedLoopResult,
): ForemanManagedLoopDisposition {
  if (result.toolBudgetExceeded) {
    return { action: "tool_budget_exceeded" };
  }
  if (result.failed) {
    return {
      action: "failed",
      message: result.failureMessage ?? result.summary,
    };
  }
  if (result.dialogueExhausted) {
    return { action: "dialogue_exhausted" };
  }
  if (result.awaitingUser) {
    return { action: "awaiting_user" };
  }
  if (result.submitForReview) {
    return { action: "complete" };
  }
  return { action: "failed", message: "工头未批准交差" };
}

export async function runForemanManagedLoop<TSession>(
  session: TSession,
  initialPrompt: string,
  ctx: ExecutorContext,
  runTurn: CrewTurnRunner<TSession>,
  opts?: { initialSteer?: boolean; logTag?: string },
): Promise<ForemanManagedLoopResult> {
  const tag = opts?.logTag ?? "crew";
  let promptText = initialPrompt;
  let steer = opts?.initialSteer ?? false;
  let crewRounds = 0;
  let foremanRounds = 0;
  let last: CrewTurnResult | undefined;

  for (let round = 0; round < MAX_FOREMAN_LOOP_ROUNDS; round += 1) {
    last = await runTurn(session, promptText, ctx, steer ? { steer: true } : undefined);
    if (last.toolBudgetExceeded) {
      return {
        summary: last.summary,
        park: last.park,
        toolBudgetExceeded: true,
        crewRounds,
        foremanRounds,
        deliverables: last.deliverables,
        dialogueExhausted: false,
      };
    }

    const question = parseCrewMessageFromText(last.assistantText);
    if (question && ctx.callbacks.onCrewQuestion) {
      crewRounds += 1;
      await ctx.callbacks.onLog(
        "info",
        `[${tag}] 施工队提问 › ${question.prompt.slice(0, 120)}`,
      );

      const directive = await ctx.callbacks.onCrewQuestion(question);
      if (directive.pauseUntilUser) {
        return {
          summary: last.summary,
          park: last.park,
          toolBudgetExceeded: false,
          crewRounds,
          foremanRounds,
          deliverables: last.deliverables,
          dialogueExhausted: false,
          awaitingUser: true,
        };
      }
      promptText = formatCrewForemanReplyForPrompt(directive);
      steer = true;
      continue;
    }

    if (ctx.callbacks.onCrewTurnReview) {
      const reviewInput: ForemanTurnReviewInput = {
        assistantText: last.assistantText,
        summary: last.summary,
        deliverables: last.deliverables,
        round,
      };
      const decision = await ctx.callbacks.onCrewTurnReview(reviewInput);

      const applied = await applyForemanTurnDecision(decision, last, {
        foremanRounds,
        crewRounds,
      });
      if (applied.type === "terminal") {
        return applied.result;
      }
      promptText = applied.promptText;
      steer = applied.steer;
      foremanRounds = applied.foremanRounds;
      continue;
    }

    // 无工头审阅回调时保持旧行为：首轮结束即交差
    return {
      summary: last.summary,
      park: last.park,
      toolBudgetExceeded: false,
      crewRounds,
      foremanRounds,
      deliverables: last.deliverables,
      dialogueExhausted: false,
      submitForReview: true,
    };
  }

  return {
    summary: last?.summary ?? "",
    park: last?.park ?? false,
    toolBudgetExceeded: false,
    crewRounds,
    foremanRounds,
    deliverables: last?.deliverables ?? [],
    dialogueExhausted: true,
  };
}

/** @deprecated 使用 runForemanManagedLoop */
export async function runCrewDialogueLoop<TSession>(
  session: TSession,
  initialPrompt: string,
  ctx: ExecutorContext,
  runTurn: CrewTurnRunner<TSession>,
  opts?: { initialSteer?: boolean; logTag?: string },
): Promise<ForemanManagedLoopResult> {
  return runForemanManagedLoop(session, initialPrompt, ctx, runTurn, opts);
}
