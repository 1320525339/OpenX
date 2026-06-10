import {
  collectGoalIntentText,
  detectGoalIntent,
  isClearRuleWinner,
  recommendExecutorId,
  type ExecutorRecommendation,
} from "@openx/shared";
import { loadSettings } from "./settings-store.js";
import type { Settings } from "@openx/shared";
import { mergedSkillBindings, resolveExecutorSkills } from "./skills-resolve.js";

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
  executors: ExecutorRow[],
): Promise<{ executorId: string; recommendReason?: string }> {
  const requested = input.executorId ?? settings.defaultExecutorId;
  if (input.executorId != null && input.executorId !== settings.defaultExecutorId) {
    return { executorId: input.executorId };
  }

  const rec = await recommendExecutorForGoal(input, executors, settings);
  if (rec) {
    return { executorId: rec.executorId, recommendReason: rec.reason };
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

export { isClearRuleWinner };
