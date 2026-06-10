import { z } from "zod";

export type SkillKind = "core" | "github";

export type CoreSkillDef = {
  id: string;
  name: string;
  desc: string;
  kind: "core";
  required?: boolean;
  defaultEnabled?: boolean;
};

export type GithubSkillSource = {
  id: string;
  /** 仓库内 skills 子目录名，如 obscura-fetch */
  dir: string;
  required?: boolean;
  defaultEnabled?: boolean;
};

/** Obscura 官方插件仓库（Agent Skills 标准） */
export const OBSCURA_SKILL_REPO = {
  owner: "epicsagas",
  repo: "obscura-plugin",
  branch: "main",
  basePath: "skills",
} as const;

export function obscuraSkillRepoSlug(): string {
  return `${OBSCURA_SKILL_REPO.owner}/${OBSCURA_SKILL_REPO.repo}`;
}

/** 从 GitHub 拉取的系统内置 Skills */
export const BUILTIN_GITHUB_SKILLS: readonly GithubSkillSource[] = [
  { id: "obscura-fetch", dir: "obscura-fetch", required: true, defaultEnabled: true },
  { id: "obscura-scrape", dir: "obscura-scrape", required: true, defaultEnabled: true },
  { id: "obscura-pipeline", dir: "obscura-pipeline", required: true, defaultEnabled: true },
  { id: "obscura-crawl", dir: "obscura-crawl", required: true, defaultEnabled: true },
] as const;

/** Pi 内置能力，无需从 GitHub 安装 */
export const CORE_SKILLS: readonly CoreSkillDef[] = [
  { id: "filesystem", name: "文件读写", desc: "读写工作目录内文件", kind: "core", defaultEnabled: true },
  { id: "shell", name: "Shell 命令", desc: "在本机工作目录执行命令", kind: "core", defaultEnabled: true },
  { id: "git", name: "Git 操作", desc: "状态、diff、提交（Pi 内置）", kind: "core" },
  { id: "search", name: "代码搜索", desc: "按关键词检索项目文件", kind: "core" },
] as const;

export type InstalledSkillRecord = {
  id: string;
  dir: string;
  repo: string;
  branch: string;
  installedAt: string;
  skillMdPath: string;
  name?: string;
  description?: string;
  error?: string;
};

export type SkillManifest = {
  version: 1;
  skills: Record<string, InstalledSkillRecord>;
};

export type SkillCatalogEntry = {
  id: string;
  name: string;
  desc: string;
  kind: SkillKind;
  required: boolean;
  defaultEnabled: boolean;
  installed: boolean;
  repo?: string;
  installError?: string;
  skillMdPath?: string;
};

export const SkillBindingSchema = z.object({
  enabled: z.boolean(),
  /** 允许使用该 Skill 的 executorId（pi / acp:* / connect executorId） */
  cliIds: z.array(z.string()),
});
export type SkillBinding = z.infer<typeof SkillBindingSchema>;

export const SkillBindingsMapSchema = z.record(SkillBindingSchema);
export type SkillBindingsMap = z.infer<typeof SkillBindingsMapSchema>;

export type ExecutionSkillHint = {
  id: string;
  name: string;
  desc: string;
  kind: SkillKind;
  skillMdPath?: string;
};

export type ResolvedExecutorSkills = {
  hints: ExecutionSkillHint[];
  /** 供 Pi loader 过滤的 GitHub Skill id */
  githubSkillIds: string[];
};

export function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const block = match[1];
  const readField = (key: string) => {
    const line = block
      .split("\n")
      .find((l) => l.startsWith(`${key}:`));
    if (!line) return undefined;
    const raw = line.slice(key.length + 1).trim();
    return raw.replace(/^['"]|['"]$/g, "");
  };

  return {
    name: readField("name"),
    description: readField("description"),
  };
}

export function githubSkillRemotePath(source: GithubSkillSource): string {
  return `${OBSCURA_SKILL_REPO.basePath}/${source.dir}`;
}

export function defaultSkillCatalog(
  manifest?: SkillManifest | null,
): SkillCatalogEntry[] {
  const installed = manifest?.skills ?? {};
  const githubEntries: SkillCatalogEntry[] = BUILTIN_GITHUB_SKILLS.map((source) => {
    const record = installed[source.id];
    const metaName = record?.name;
    const metaDesc = record?.description;
    return {
      id: source.id,
      name: metaName ?? source.dir,
      desc: metaDesc ?? `Obscura · ${source.dir}`,
      kind: "github" as const,
      required: source.required ?? false,
      defaultEnabled: source.defaultEnabled ?? false,
      installed: Boolean(record && !record.error),
      repo: obscuraSkillRepoSlug(),
      installError: record?.error,
      skillMdPath: record?.skillMdPath,
    };
  });

  const coreEntries: SkillCatalogEntry[] = CORE_SKILLS.map((skill) => ({
    id: skill.id,
    name: skill.name,
    desc: skill.desc,
    kind: "core",
    required: skill.required ?? false,
    defaultEnabled: skill.defaultEnabled ?? false,
    installed: true,
  }));

  return [...coreEntries, ...githubEntries];
}

/** 无显式绑定时：defaultEnabled 的 Skill 默认只给 pi */
export function isSkillEnabledForExecutor(
  skill: SkillCatalogEntry,
  executorId: string,
  binding: SkillBinding | undefined,
): boolean {
  if (binding) {
    return binding.enabled && binding.cliIds.includes(executorId);
  }
  return skill.defaultEnabled && executorId === "pi";
}

export function mergeSkillBindings(
  stored: SkillBindingsMap,
  catalog: SkillCatalogEntry[],
  allCliIds: string[],
): SkillBindingsMap {
  const out: SkillBindingsMap = {};
  for (const skill of catalog) {
    const prev = stored[skill.id];
    if (prev) {
      out[skill.id] = {
        enabled: prev.enabled,
        cliIds: prev.cliIds.filter((id) => allCliIds.includes(id)),
      };
      continue;
    }
    const enabled = skill.defaultEnabled;
    const cliIds =
      enabled && allCliIds.includes("pi")
        ? ["pi"]
        : enabled
          ? allCliIds.slice(0, 1)
          : [];
    out[skill.id] = { enabled, cliIds };
  }
  return out;
}

export function resolveSkillsForExecutor(
  executorId: string,
  bindings: SkillBindingsMap,
  catalog: SkillCatalogEntry[],
  manifest?: SkillManifest | null,
): ResolvedExecutorSkills {
  const installed = manifest?.skills ?? {};
  const hints: ExecutionSkillHint[] = [];
  const githubSkillIds: string[] = [];

  for (const skill of catalog) {
    if (!isSkillEnabledForExecutor(skill, executorId, bindings[skill.id])) continue;
    if (skill.kind === "github" && !skill.installed) continue;

    const record = installed[skill.id];
    hints.push({
      id: skill.id,
      name: skill.name,
      desc: skill.desc,
      kind: skill.kind,
      skillMdPath: skill.skillMdPath ?? record?.skillMdPath,
    });
    if (skill.kind === "github") githubSkillIds.push(skill.id);
  }

  return { hints, githubSkillIds };
}

export function buildSkillsPromptBlock(hints: ExecutionSkillHint[]): string {
  if (hints.length === 0) return "";
  const lines = hints.map((s) => {
    const pathHint = s.skillMdPath ? ` · SKILL.md: ${s.skillMdPath}` : "";
    return `- ${s.name} (${s.id}): ${s.desc}${pathHint}`;
  });
  return [
    "【可用 Skills】",
    "以下 Skill 已为本执行器启用。GitHub/Obscura 类 Skill 请先读取对应 SKILL.md 再按说明调用（如 obscura CLI）。",
    ...lines,
  ].join("\n");
}

export function enrichGoalExecutionPrompt(
  executionPrompt: string,
  hints: ExecutionSkillHint[],
): string {
  const block = buildSkillsPromptBlock(hints);
  if (!block) return executionPrompt;
  return `${executionPrompt}\n\n${block}`;
}

const SKILL_BODY_MAX_CHARS = 12_000;

/** Connect / 外部 Agent：将 SKILL.md 正文拼入 system prompt */
export function formatSkillsSystemAppend(
  hints: ExecutionSkillHint[],
  bodies: Record<string, string>,
): string {
  const github = hints.filter((h) => h.kind === "github" && bodies[h.id]?.trim());
  if (github.length === 0) return "";

  const sections = github.map((h) => {
    let body = bodies[h.id].trim();
    if (body.length > SKILL_BODY_MAX_CHARS) {
      body = `${body.slice(0, SKILL_BODY_MAX_CHARS)}\n\n…（SKILL.md 已截断）`;
    }
    return `### Skill: ${h.name} (${h.id})\n\n${body}`;
  });

  return [
    "# OpenX 已启用 Skills",
    "执行下列任务时优先遵循对应 Skill 说明（含 Obscura CLI 用法）。",
    "",
    ...sections,
  ].join("\n");
}
