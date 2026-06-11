import {
  ACP_RUNTIMES,
  type CliProfile,
  type Settings,
  type SkillBindingsMap,
} from "@openx/shared";
import { listKnownExecutorIds } from "./skills-resolve.js";

export type ManagedAgentInfo = {
  executorId: string;
  label: string;
  kind: "pi" | "acp" | "connect";
  available: boolean;
  hint?: string;
  assignedSkillIds: string[];
};

type ExecutorRow = {
  id: string;
  displayName: string;
  available: boolean;
  hint?: string;
};

export function listManagedAgents(
  executors: ExecutorRow[],
  profiles: CliProfile[] = [],
  bindings: SkillBindingsMap = {},
): ManagedAgentInfo[] {
  const rows: ManagedAgentInfo[] = [];
  const seen = new Set<string>();

  const assignedFor = (executorId: string): string[] =>
    Object.entries(bindings)
      .filter(([, b]) => b.enabled && b.cliIds.includes(executorId))
      .map(([id]) => id);

  const pi = executors.find((e) => e.id === "pi");
  if (pi) {
    rows.push({
      executorId: "pi",
      label: "Pi 内嵌底座",
      kind: "pi",
      available: pi.available,
      hint: pi.hint,
      assignedSkillIds: assignedFor("pi"),
    });
    seen.add("pi");
  }

  for (const e of executors) {
    if (!e.id.startsWith("acp:")) continue;
    rows.push({
      executorId: e.id,
      label: e.displayName,
      kind: "acp",
      available: e.available,
      hint: e.hint,
      assignedSkillIds: assignedFor(e.id),
    });
    seen.add(e.id);
  }

  for (const profile of profiles) {
    if (profile.kind === "acp" || seen.has(profile.executorId)) continue;
    const ex = executors.find((e) => e.id === profile.executorId);
    rows.push({
      executorId: profile.executorId,
      label: profile.displayName,
      kind: "connect",
      available: ex?.available ?? false,
      hint: ex?.hint ?? "已配置 · 未在线",
      assignedSkillIds: assignedFor(profile.executorId),
    });
    seen.add(profile.executorId);
  }

  for (const e of executors) {
    if (e.id === "pi" || e.id === "auto" || e.id.startsWith("acp:") || seen.has(e.id)) continue;
    rows.push({
      executorId: e.id,
      label: e.displayName,
      kind: "connect",
      available: e.available,
      hint: e.hint,
      assignedSkillIds: assignedFor(e.id),
    });
    seen.add(e.id);
  }

  for (const id of Object.keys(ACP_RUNTIMES)) {
    const fullId = `acp:${id}`;
    if (seen.has(fullId)) continue;
    rows.push({
      executorId: fullId,
      label: ACP_RUNTIMES[id as keyof typeof ACP_RUNTIMES].label,
      kind: "acp",
      available: false,
      hint: "未检测",
      assignedSkillIds: assignedFor(fullId),
    });
  }

  return rows;
}

/** 不触发 detectExecutors：仅根据配置与注册表列出可绑定 Agent（在线状态为未知） */
export function listManagedAgentsFromRegistry(
  settings: Settings,
  bindings: SkillBindingsMap = {},
): ManagedAgentInfo[] {
  const profiles = settings.cliProfiles ?? [];
  const rows: ManagedAgentInfo[] = [];
  const seen = new Set<string>();

  const assignedFor = (executorId: string): string[] =>
    Object.entries(bindings)
      .filter(([, b]) => b.enabled && b.cliIds.includes(executorId))
      .map(([id]) => id);

  const labelFor = (executorId: string): string => {
    if (executorId === "pi") return "Pi 内嵌底座";
    const runtime = ACP_RUNTIMES[executorId as keyof typeof ACP_RUNTIMES];
    if (runtime) return runtime.label;
    const profile = profiles.find((p) => p.executorId === executorId);
    if (profile) return profile.displayName;
    return executorId;
  };

  const kindFor = (executorId: string): ManagedAgentInfo["kind"] => {
    if (executorId === "pi") return "pi";
    if (executorId.startsWith("acp:")) return "acp";
    return "connect";
  };

  for (const executorId of listKnownExecutorIds(settings)) {
    if (seen.has(executorId)) continue;
    seen.add(executorId);
    rows.push({
      executorId,
      label: labelFor(executorId),
      kind: kindFor(executorId),
      available: false,
      hint: "在线状态请刷新执行器检测",
      assignedSkillIds: assignedFor(executorId),
    });
  }

  for (const id of Object.keys(ACP_RUNTIMES)) {
    if (seen.has(id)) continue;
    rows.push({
      executorId: id,
      label: ACP_RUNTIMES[id as keyof typeof ACP_RUNTIMES].label,
      kind: "acp",
      available: false,
      hint: "未检测",
      assignedSkillIds: assignedFor(id),
    });
  }

  return rows;
}
