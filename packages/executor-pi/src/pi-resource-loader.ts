import {
  DefaultResourceLoader,
  getAgentDir,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { getOpenxSkillsDir } from "@openx/shared/skills-path";
import { basename } from "node:path";
import { existsSync } from "node:fs";

function skillMatchesFilter(
  skillName: string,
  baseDir: string,
  allowedIds: Set<string>,
): boolean {
  if (allowedIds.size === 0) return true;
  const folder = basename(baseDir);
  return allowedIds.has(skillName) || allowedIds.has(folder);
}

/** 加载 OpenX 内置 Skills（~/.openx/skills），可按 id 过滤 */
export async function createOpenxResourceLoader(
  cwd: string,
  githubSkillIds?: string[],
): Promise<ResourceLoader | undefined> {
  const skillsDir = getOpenxSkillsDir();
  if (!existsSync(skillsDir)) return undefined;

  const allowed = new Set(githubSkillIds ?? []);
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    additionalSkillPaths: [skillsDir],
    skillsOverride: (current) => {
      if (allowed.size === 0) return current;
      return {
        skills: current.skills.filter((s) =>
          skillMatchesFilter(s.name, s.baseDir, allowed),
        ),
        diagnostics: current.diagnostics,
      };
    },
  });
  await loader.reload();
  return loader;
}
