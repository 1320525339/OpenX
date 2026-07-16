import type { AgentCatalogEntry, SkillCatalogEntry, SkillKind } from "@openx/shared";
import { CORE_SKILLS, COACH_AGENT_ROLES, type DispatchPermissionMode } from "@openx/shared";

export type CoachSkill = {
  id: string;
  name: string;
  desc: string;
  kind?: SkillKind;
  required?: boolean;
  defaultEnabled?: boolean;
  installed?: boolean;
  installError?: string;
};

export type CoachMcp = {
  id: string;
  name: string;
  desc: string;
};

export type CoachAgent = {
  id: string;
  name: string;
  desc: string;
};

/** 本地 fallback（API 未加载时使用） */
export const COACH_SKILLS: CoachSkill[] = CORE_SKILLS.map((s) => ({
  id: s.id,
  name: s.name,
  desc: s.desc,
  kind: s.kind,
  required: s.required,
  defaultEnabled: s.defaultEnabled,
  installed: true,
}));

export function catalogToCoachSkills(catalog: SkillCatalogEntry[]): CoachSkill[] {
  return catalog.map((s) => ({
    id: s.id,
    name: s.name,
    desc: s.desc,
    kind: s.kind,
    required: s.required,
    defaultEnabled: s.defaultEnabled,
    installed: s.installed,
    installError: s.installError,
  }));
}

export const COACH_MCPS: CoachMcp[] = [
  { id: "browser", name: "浏览器", desc: "页面导航、截图与交互（IDE Browser MCP）" },
  { id: "workspace", name: "工作区", desc: "项目与工作区控制（App Control MCP）" },
  { id: "filesystem", name: "文件 MCP", desc: "通过 MCP 读写与检索文件" },
];

export const COACH_AGENTS: CoachAgent[] = Object.entries(COACH_AGENT_ROLES).map(
  ([id, role]) => ({
    id,
    name: role.name,
    desc: role.desc,
  }),
);

export function catalogToCoachAgents(catalog: AgentCatalogEntry[]): CoachAgent[] {
  return catalog.map((a) => ({
    id: a.id,
    name: a.name,
    desc: a.desc,
  }));
}

const SKILLS_KEY = "openx.tools.skills";
const SKILLS_BINDINGS_KEY = "openx.tools.skillBindings";
const MCPS_KEY = "openx.chat.mcps";
const AGENT_KEY = "openx.chat.agent";
const PERMISSION_KEY = "openx.chat.permissionMode";

export type ChatPermissionSelection = DispatchPermissionMode | "default";

export type SkillBinding = {
  enabled: boolean;
  /** 允许调用该 Skill 的 CLI executorId 列表 */
  cliIds: string[];
};

function defaultEnabledForSkill(skill: CoachSkill): boolean {
  return skill.defaultEnabled ?? (skill.id === "filesystem" || skill.id === "shell");
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function defaultCliIdsForSkill(allCliIds: string[]): string[] {
  if (allCliIds.includes("pi")) return ["pi"];
  return allCliIds.slice(0, 1);
}

export function loadSkillBindings(
  allCliIds: string[],
  skills: CoachSkill[] = COACH_SKILLS,
): Record<string, SkillBinding> {
  const stored = readJson<Record<string, SkillBinding>>(SKILLS_BINDINGS_KEY, {});
  const legacy = readJson<Record<string, boolean>>(SKILLS_KEY, {});

  return skills.reduce<Record<string, SkillBinding>>((acc, skill) => {
    const prev = stored[skill.id];
    if (prev) {
      acc[skill.id] = {
        enabled: prev.enabled,
        cliIds: prev.cliIds.filter((id) => allCliIds.includes(id)),
      };
      return acc;
    }
    const enabled = legacy[skill.id] ?? defaultEnabledForSkill(skill);
    acc[skill.id] = {
      enabled,
      cliIds: enabled ? defaultCliIdsForSkill(allCliIds) : [],
    };
    return acc;
  }, {});
}

export function saveSkillBindings(next: Record<string, SkillBinding>, skills: CoachSkill[] = COACH_SKILLS) {
  localStorage.setItem(SKILLS_BINDINGS_KEY, JSON.stringify(next));
  const legacy = skills.reduce<Record<string, boolean>>((acc, skill) => {
    acc[skill.id] = next[skill.id]?.enabled ?? false;
    return acc;
  }, {});
  localStorage.setItem(SKILLS_KEY, JSON.stringify(legacy));
}

export function loadSkillSelection(skills: CoachSkill[] = COACH_SKILLS): Record<string, boolean> {
  const storedBindings = readJson<Record<string, SkillBinding>>(SKILLS_BINDINGS_KEY, {});
  if (Object.keys(storedBindings).length > 0) {
    return skills.reduce<Record<string, boolean>>((acc, skill) => {
      acc[skill.id] = storedBindings[skill.id]?.enabled ?? defaultEnabledForSkill(skill);
      return acc;
    }, {});
  }
  const stored = readJson<Record<string, boolean>>(SKILLS_KEY, {});
  return skills.reduce<Record<string, boolean>>((acc, skill) => {
    acc[skill.id] = stored[skill.id] ?? defaultEnabledForSkill(skill);
    return acc;
  }, {});
}

export function saveSkillSelection(next: Record<string, boolean>, skills: CoachSkill[] = COACH_SKILLS) {
  localStorage.setItem(SKILLS_KEY, JSON.stringify(next));
  const bindings = readJson<Record<string, SkillBinding>>(SKILLS_BINDINGS_KEY, {});
  if (Object.keys(bindings).length === 0) return;
  const merged = { ...bindings };
  for (const skill of skills) {
    const prev = merged[skill.id] ?? { enabled: false, cliIds: [] };
    merged[skill.id] = { ...prev, enabled: next[skill.id] ?? false };
  }
  localStorage.setItem(SKILLS_BINDINGS_KEY, JSON.stringify(merged));
}

export function loadMcpSelection(catalog: CoachMcp[] = COACH_MCPS): Record<string, boolean> {
  const stored = readJson<Record<string, boolean>>(MCPS_KEY, {});
  return catalog.reduce<Record<string, boolean>>((acc, mcp) => {
    acc[mcp.id] = stored[mcp.id] ?? false;
    return acc;
  }, {});
}

export function saveMcpSelection(next: Record<string, boolean>) {
  const stored = readJson<Record<string, boolean>>(MCPS_KEY, {});
  localStorage.setItem(MCPS_KEY, JSON.stringify({ ...stored, ...next }));
}

export function enabledSelectionIds(map: Record<string, boolean>): string[] {
  return Object.entries(map)
    .filter(([, on]) => on)
    .map(([id]) => id);
}

export function loadAgentSelection(catalog: CoachAgent[] = COACH_AGENTS): string {
  const raw = localStorage.getItem(AGENT_KEY) ?? "coach";
  const stored = raw === "pi" ? "coder" : raw;
  if (catalog.some((a) => a.id === stored)) return stored;
  return catalog[0]?.id ?? "coach";
}

export function saveAgentSelection(agentId: string) {
  localStorage.setItem(AGENT_KEY, agentId);
}

export function loadPermissionSelection(): ChatPermissionSelection {
  const raw = localStorage.getItem(PERMISSION_KEY);
  if (raw === "read_only" || raw === "ask_write" || raw === "full") return raw;
  return "default";
}

export function savePermissionSelection(mode: ChatPermissionSelection) {
  if (mode === "default") {
    localStorage.removeItem(PERMISSION_KEY);
    return;
  }
  localStorage.setItem(PERMISSION_KEY, mode);
}

export function permissionModeFromSelection(
  selection: ChatPermissionSelection,
): DispatchPermissionMode | undefined {
  return selection === "default" ? undefined : selection;
}

export function countEnabled(map: Record<string, boolean>) {
  return Object.values(map).filter(Boolean).length;
}
