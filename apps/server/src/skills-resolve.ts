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
    ids.add(key);
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
  goalSkillIds?: string[],
): { hints: ExecutionSkillHint[]; githubSkillIds: string[] } {
  const manifest = loadSkillManifest();
  const catalog = defaultSkillCatalog(manifest);
  const bindings = mergedSkillBindings(settings);
  const base = resolveSkillsForExecutor(executorId, bindings, catalog, manifest);

  if (!goalSkillIds?.length) return base;

  const selected = new Set(goalSkillIds);
  const installed = manifest?.skills ?? {};
  const extra: ExecutionSkillHint[] = [];

  for (const skill of catalog) {
    if (!selected.has(skill.id)) continue;
    if (base.hints.some((h) => h.id === skill.id)) continue;
    if (skill.kind === "github" && !skill.installed) continue;
    const record = installed[skill.id];
    extra.push({
      id: skill.id,
      name: skill.name,
      desc: skill.desc,
      kind: skill.kind,
      skillMdPath: skill.skillMdPath ?? record?.skillMdPath,
    });
  }

  const hints = [
    ...base.hints.filter((h) => selected.has(h.id)),
    ...extra,
  ];
  const githubSkillIds = hints
    .filter((h) => catalog.find((s) => s.id === h.id)?.kind === "github")
    .map((h) => h.id);

  return { hints, githubSkillIds };
}

/** Connect heartbeat：为 pending goal 注入 Skills 与系统工作目录说明（不写库） */
export function enrichGoalWithSkills(
  goal: Goal,
  settings: Settings,
  workspaceRoot?: string,
): Goal {
  const { hints } = resolveExecutorSkills(
    goal.executorId,
    settings,
    goal.dispatchContext?.skillIds,
  );
  let executionPrompt = enrichGoalExecutionPrompt(goal.executionPrompt, hints);
  if (workspaceRoot?.trim()) {
    executionPrompt = [
      "【工作目录】",
      workspaceRoot.trim(),
      "Skills 链接：.openx/skills · Agents：.openx/agents · MCP 配置：.mcp.json",
      "",
      executionPrompt,
    ].join("\n");
  }
  return {
    ...goal,
    executionPrompt,
  };
}
