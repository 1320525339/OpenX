import {
  getCoachRuntime,
  resolveForemanDirectiveViaCoach,
  resolveForemanTurnReviewViaCoach,
  type ForemanCrewOptions,
} from "@openx/coach";
import {
  ensureCrewRequestId,
  resolveForemanDirectiveAuto,
  resolveForemanTurnDecisionAuto,
  withCrewReplyCorrelation,
  type ForemanLoopInput,
  type ForemanTurnReviewLoopInput,
  type ForemanTurnDecision,
} from "@openx/shared";
import { appendLog } from "./db.js";
import { loadSettings } from "./settings-store.js";
import { prepareCoachThreadForPrompt } from "./coach-thread-service.js";
import { resolveMergedLlmContext } from "./llm-context-resolve.js";
import {
  buildBrowserDesktopContext,
  pinDesktopScopeForConversation,
} from "./browser-desktop-context.js";

export {
  resolveForemanDirectiveAuto,
  resolveForemanTurnDecisionAuto,
  isCrewEscalation,
  isCrewDirective,
  type ForemanLoopInput,
  type ForemanTurnReviewLoopInput,
} from "@openx/shared";

type ForemanGoalBinding = ForemanLoopInput["goal"];

function buildForemanCrewOptions(goal: ForemanGoalBinding): ForemanCrewOptions {
  const threadId = goal.foremanThreadId ?? goal.conversationId;
  const prepared = prepareCoachThreadForPrompt(threadId, {
    messageLimit: 40,
    includeExecutionSnapshots: true,
    includeOperatorActions: false,
  });
  return {
    coachThreadPrefix: prepared.block || undefined,
    llmContextSettings: resolveMergedLlmContext({
      conversationId: goal.conversationId,
      goalId: goal.id,
    }),
  };
}

async function buildForemanCrewOptionsAsync(
  goal: ForemanGoalBinding,
): Promise<ForemanCrewOptions> {
  const base = buildForemanCrewOptions(goal);
  const scope = pinDesktopScopeForConversation(goal.conversationId);
  const browserDesktopContext = await buildBrowserDesktopContext(scope);
  return {
    ...base,
    browserDesktopContext,
  };
}

function shouldUseRulesOnly(): boolean {
  return process.env.OPENX_FOREMAN_RULES_ONLY === "1";
}

/** 工头决策：Coach LLM 自然语言对话，失败或未配置时兜底 */
export async function handleCrewQuestion(input: ForemanLoopInput) {
  const question = ensureCrewRequestId(input.question);
  const bound = { ...input, question };

  if (shouldUseRulesOnly()) {
    return resolveForemanDirectiveAuto(bound);
  }

  const settings = loadSettings();
  const runtime = getCoachRuntime(settings);
  if (!runtime.ready) {
    return resolveForemanDirectiveAuto(bound);
  }

  const { outcome, llmError } = await resolveForemanDirectiveViaCoach(
    {
      goal: {
        id: bound.goal.id,
        title: bound.goal.title,
        acceptance: bound.goal.acceptance,
        executionPrompt: bound.goal.executionPrompt,
        constraints: bound.goal.constraints,
      },
      question,
    },
    settings,
    process.env as Record<string, string | undefined>,
    await buildForemanCrewOptionsAsync(bound.goal),
  );

  if (outcome) {
    const correlated = withCrewReplyCorrelation(question, outcome);
    appendLog(
      bound.goal.id,
      "info",
      `工头 LLM 决策 › ${correlated.kind === "directive" ? correlated.message.slice(0, 160) : correlated.prompt.slice(0, 160)}`,
    );
    return correlated;
  }

  appendLog(
    bound.goal.id,
    "warn",
    `工头 LLM 不可用，使用兜底答复${llmError ? `：${llmError.slice(0, 120)}` : ""}`,
  );
  return resolveForemanDirectiveAuto(bound);
}

/** 工头主动轮次审阅：每轮施工反馈后的 loop controller 决策 */
export async function handleCrewTurnReview(
  input: ForemanTurnReviewLoopInput,
): Promise<ForemanTurnDecision> {
  const { goal } = input;

  if (shouldUseRulesOnly()) {
    return resolveForemanTurnDecisionAuto(input);
  }

  const settings = loadSettings();
  const runtime = getCoachRuntime(settings);
  if (!runtime.ready) {
    return resolveForemanTurnDecisionAuto(input);
  }

  const { decision, llmError } = await resolveForemanTurnReviewViaCoach(
    {
      goal: {
        id: goal.id,
        title: goal.title,
        acceptance: goal.acceptance,
        executionPrompt: goal.executionPrompt,
        constraints: goal.constraints,
      },
      turn: input.turn,
    },
    settings,
    process.env as Record<string, string | undefined>,
    await buildForemanCrewOptionsAsync(goal),
  );

  if (decision) {
    appendLog(
      goal.id,
      "info",
      `工头轮次审阅 › ${decision.action}: ${decision.message.slice(0, 160)}`,
    );
    return decision;
  }

  appendLog(
    goal.id,
    "warn",
    `工头轮次审阅 LLM 不可用，使用兜底${llmError ? `：${llmError.slice(0, 120)}` : ""}`,
  );
  return resolveForemanTurnDecisionAuto(input);
}
