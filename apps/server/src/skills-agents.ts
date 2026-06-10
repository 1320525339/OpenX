import { ACP_RUNTIMES, type CliProfile, type SkillBindingsMap } from "@openx/shared";

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
