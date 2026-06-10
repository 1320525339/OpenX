import {
  ACP_RUNTIMES,
  defaultSkillCatalog,
  enrichGoalExecutionPrompt,
  mergeSkillBindings,
  resolveSkillsForExecutor,
  type ExecutionSkillHint,
  type Goal,
  type Settings,
  type SkillBindingsMap,
} from "@openx/shared";
import { listConnections } from "./connect-store.js";
import { loadSkillManifest } from "./skills-service.js";

/** 已知 executorId：pi、acp:*、Connect 注册 id */
export function listKnownExecutorIds(settings: Settings): string[] {
  const ids = new Set<string>(["pi"]);
  for (const key of Object.keys(ACP_RUNTIMES)) {
    ids.add(`acp:${key}`);
  }
  for (const profile of settings.cliProfiles ?? []) {
    ids.add(profile.executorId);
  }
  for (const conn of listConnections()) {
    ids.add(conn.executorId);
  }
  return [...ids];
}

export function mergedSkillBindings(settings: Settings): SkillBindingsMap {
  const catalog = defaultSkillCatalog(loadSkillManifest());
  const cliIds = listKnownExecutorIds(settings);
  return mergeSkillBindings(settings.skillBindings ?? {}, catalog, cliIds);
}

export function resolveExecutorSkills(
  executorId: string,
  settings: Settings,
): { hints: ExecutionSkillHint[]; githubSkillIds: string[] } {
  const manifest = loadSkillManifest();
  const catalog = defaultSkillCatalog(manifest);
  const bindings = mergedSkillBindings(settings);
  return resolveSkillsForExecutor(executorId, bindings, catalog, manifest);
}

/** Connect heartbeat：为 pending goal 注入 Skills 说明（不写库） */
export function enrichGoalWithSkills(goal: Goal, settings: Settings): Goal {
  const { hints } = resolveExecutorSkills(goal.executorId, settings);
  return {
    ...goal,
    executionPrompt: enrichGoalExecutionPrompt(goal.executionPrompt, hints),
  };
}
