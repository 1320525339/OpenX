import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  formatSkillsSystemAppend,
  resolveSkillsForExecutor,
  type ExecutionSkillHint,
  type SkillBindingsMap,
  type SkillCatalogEntry,
} from "@openx/shared";
import { getOpenxSkillsDir } from "@openx/shared/skills-path";

export type SkillsApiResponse = {
  skills: SkillCatalogEntry[];
  bindings: SkillBindingsMap;
  skillsDir: string;
};

export function resolveConnectSkills(
  executorId: string,
  api: SkillsApiResponse,
): ExecutionSkillHint[] {
  return resolveSkillsForExecutor(executorId, api.bindings, api.skills).hints;
}

export function readSkillBodies(
  hints: ExecutionSkillHint[],
  skillsDir: string,
): Record<string, string> {
  const bodies: Record<string, string> = {};
  for (const hint of hints) {
    if (hint.kind !== "github") continue;
    const path = hint.skillMdPath ?? join(skillsDir, hint.id, "SKILL.md");
    if (!existsSync(path)) continue;
    try {
      bodies[hint.id] = readFileSync(path, "utf8");
    } catch {
      /* ignore */
    }
  }
  return bodies;
}

export function buildConnectSkillsSystem(
  hints: ExecutionSkillHint[],
  skillsDir?: string,
): string {
  const dir = skillsDir?.trim() || process.env.OPENX_SKILLS_DIR?.trim() || getOpenxSkillsDir();
  const bodies = readSkillBodies(hints, dir);
  return formatSkillsSystemAppend(hints, bodies);
}
