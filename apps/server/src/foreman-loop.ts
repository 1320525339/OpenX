import {
  getCoachRuntime,
  resolveForemanDirectiveViaCoach,
  type ForemanCrewOptions,
} from "@openx/coach";
import {
  resolveForemanDirectiveAuto,
  type ForemanLoopInput,
} from "@openx/shared";
import { appendLog } from "./db.js";
import { loadSettings } from "./settings-store.js";
import { prepareCoachThreadForPrompt } from "./coach-thread-service.js";
import { resolveMergedLlmContext } from "./llm-context-resolve.js";

export {
  resolveForemanDirectiveAuto,
  isCrewEscalation,
  isCrewDirective,
  type ForemanLoopInput,
} from "@openx/shared";

function buildForemanCrewOptions(
  input: ForemanLoopInput,
): ForemanCrewOptions {
  const threadId = input.goal.foremanThreadId ?? input.goal.conversationId;
  const prepared = prepareCoachThreadForPrompt(threadId, {
    messageLimit: 40,
    includeExecutionSnapshots: true,
    includeOperatorActions: false,
  });
  return {
    coachThreadPrefix: prepared.block || undefined,
    llmContextSettings: resolveMergedLlmContext({
      conversationId: input.goal.conversationId,
      goalId: input.goal.id,
    }),
  };
}

function shouldUseRulesOnly(): boolean {
  return process.env.OPENX_FOREMAN_RULES_ONLY === "1";
}

/** 工头决策：Coach LLM 自然语言对话，失败或未配置时兜底 */
export async function handleCrewQuestion(input: ForemanLoopInput) {
  const { goal, question } = input;

  if (shouldUseRulesOnly()) {
    return resolveForemanDirectiveAuto(input);
  }

  const settings = loadSettings();
  const runtime = getCoachRuntime(settings);
  if (!runtime.ready) {
    return resolveForemanDirectiveAuto(input);
  }

  const { outcome, llmError } = await resolveForemanDirectiveViaCoach(
    {
      goal: {
        id: goal.id,
        title: goal.title,
        acceptance: goal.acceptance,
        executionPrompt: goal.executionPrompt,
        constraints: goal.constraints,
      },
      question,
    },
    settings,
    process.env as Record<string, string | undefined>,
    buildForemanCrewOptions(input),
  );

  if (outcome) {
    appendLog(
      goal.id,
      "info",
      `工头 LLM 决策 › ${outcome.kind === "directive" ? outcome.message.slice(0, 160) : outcome.prompt.slice(0, 160)}`,
    );
    return outcome;
  }

  appendLog(
    goal.id,
    "warn",
    `工头 LLM 不可用，使用兜底答复${llmError ? `：${llmError.slice(0, 120)}` : ""}`,
  );
  return resolveForemanDirectiveAuto(input);
}
