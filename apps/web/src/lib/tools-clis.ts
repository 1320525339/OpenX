import type { CliProfile } from "@openx/shared";
import type { ExecutorInfo } from "../api";
import { executorDisplayLabel } from "./executors";

export type CliEntry = {
  id: string;
  label: string;
  kind: "pi" | "acp" | "connect";
  available: boolean;
  hint?: string;
  deletable?: boolean;
  canBootstrap?: boolean;
  profile?: CliProfile;
  tutorialUrl?: string;
};

export function listManagedClis(
  executors: ExecutorInfo[],
  profiles: CliProfile[] = [],
): CliEntry[] {
  const rows: CliEntry[] = [];
  const profileById = new Map(profiles.map((p) => [p.executorId, p]));
  const seen = new Set<string>();

  const pi = executors.find((e) => e.id === "pi");
  if (pi) {
    rows.push({
      id: "pi",
      label: "Pi 内嵌底座",
      kind: "pi",
      available: pi.available,
      hint: pi.hint,
      deletable: false,
    });
    seen.add("pi");
  }

  for (const e of executors) {
    if (!e.id.startsWith("acp:")) continue;
    rows.push({
      id: e.id,
      label: e.displayName,
      kind: "acp",
      available: e.available,
      hint: e.hint,
      deletable: false,
      tutorialUrl: profileById.get(e.id)?.tutorialUrl,
    });
    seen.add(e.id);
  }

  for (const profile of profiles) {
    if (profile.kind === "acp" || seen.has(profile.executorId)) continue;
    const ex = executors.find((e) => e.id === profile.executorId);
    rows.push({
      id: profile.executorId,
      label: profile.displayName,
      kind: "connect",
      available: ex?.available ?? false,
      hint: ex?.hint ?? "已配置 · 未在线",
      deletable: true,
      canBootstrap: profile.kind === "connect",
      profile,
      tutorialUrl: profile.tutorialUrl,
    });
    seen.add(profile.executorId);
  }

  for (const e of executors) {
    if (e.id === "pi" || e.id === "auto" || e.id.startsWith("acp:") || seen.has(e.id)) continue;
    const profile = profileById.get(e.id);
    rows.push({
      id: e.id,
      label: e.displayName,
      kind: "connect",
      available: e.available,
      hint: e.hint,
      deletable: Boolean(profile),
      canBootstrap: Boolean(profile?.kind === "connect"),
      profile,
      tutorialUrl: profile?.tutorialUrl,
    });
    seen.add(e.id);
  }

  return rows;
}

/** Skills 分配：Pi + 已添加的 CLI 配置 + 本机已就绪的 ACP */
export function listInstalledClis(
  executors: ExecutorInfo[],
  profiles: CliProfile[] = [],
): CliEntry[] {
  const profileIds = new Set(profiles.map((p) => p.executorId));
  return listManagedClis(executors, profiles).filter((cli) => {
    if (cli.id === "pi") return true;
    if (profileIds.has(cli.id)) return true;
    if (cli.kind === "acp" && cli.available) return true;
    return false;
  });
}

export function cliKindLabel(kind: CliEntry["kind"]): string {
  if (kind === "pi") return "内嵌";
  if (kind === "acp") return "ACP CLI";
  return "Connect";
}

export function cliShortLabel(id: string): string {
  return executorDisplayLabel(id);
}
