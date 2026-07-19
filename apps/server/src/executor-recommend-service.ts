import {
  collectGoalIntentText,
  detectGoalIntent,
  EXECUTOR_AUTO,
  isClearRuleWinner,
  recommendExecutorId,
  type ExecutorRecommendation,
} from "@openx/shared";
import { loadSettings } from "./settings-store.js";
import type { Settings } from "@openx/shared";
import { mergedSkillBindings, resolveExecutorSkills } from "./skills-resolve.js";

export { isClearRuleWinner };

export type RecommendExecutorInput = {
  title?: string;
  acceptance?: string;
  executionPrompt?: string;
  userDraft?: string;
};

type ExecutorRow = {
  id: string;
  available: boolean;
};

export async function recommendExecutorForGoal(
  input: RecommendExecutorInput,
  executors: ExecutorRow[],
  settings: Settings = loadSettings(),
): Promise<ExecutorRecommendation | null> {
  const intent = detectGoalIntent(collectGoalIntentText(input));

  const candidates = executors
    .filter((e) => e.id !== "auto")
    .map((e) => {
      const { hints } = resolveExecutorSkills(e.id, settings);
      return {
        executorId: e.id,
        available: e.available,
        enabledSkillIds: hints.map((h) => h.id),
      };
    });

  return recommendExecutorId(candidates, intent);
}

export async function resolveGoalExecutorId(
  input: RecommendExecutorInput & { executorId?: string },
  settings: Settings,
  _executors: ExecutorRow[],
): Promise<{ executorId: string; recommendReason?: string }> {
  if (input.executorId != null) {
    return { executorId: input.executorId };
  }

  const requested = settings.defaultExecutorId;
  // 保持 auto：实际选型推迟到派发时 materializeAutoExecutor（规则硬胜出或 Pi LLM）
  if (requested === EXECUTOR_AUTO) {
    return {
      executorId: EXECUTOR_AUTO,
      recommendReason: "默认自动选型，将在派发时按规则/Pi 确定执行器",
    };
  }
  return { executorId: requested };
}

export function buildExecutorSkillsMap(settings: Settings = loadSettings()): Record<string, string[]> {
  const bindings = mergedSkillBindings(settings);
  const out: Record<string, string[]> = {};

  for (const executorId of new Set(
    Object.values(bindings).flatMap((b) => (b.enabled ? b.cliIds : [])),
  )) {
    const { hints } = resolveExecutorSkills(executorId, settings);
    if (hints.length > 0) {
      out[executorId] = hints.map((h) => `${h.name} (${h.id})`);
    }
  }

  return out;
}
