import type { CliProfile } from "@openx/shared";
import type { ExecutorInfo } from "../api";
import { cliKindLabel, listInstalledClis, type CliEntry } from "./tools-clis";

export type ConsoleConnection = {
  connectionId: string;
  toolName: string;
  agentName: string;
  executorId: string;
  connectedAt: string;
  lastHeartbeatAt: string;
};

export type ConsoleAgentStatusTone = "ok" | "warn" | "off";

export type ConsoleAgentRow = CliEntry & {
  lastHeartbeatAt?: string;
  connectLinked: boolean;
  statusLabel: string;
  statusTone: ConsoleAgentStatusTone;
};

function formatHeartbeat(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const deltaSec = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (deltaSec < 60) return `${deltaSec} 秒前`;
  return `${Math.round(deltaSec / 60)} 分钟前`;
}

export function buildConsoleAgentRows(
  executors: ExecutorInfo[],
  profiles: CliProfile[],
  connections: ConsoleConnection[],
): ConsoleAgentRow[] {
  const connByExecutor = new Map(connections.map((c) => [c.executorId, c]));

  return listInstalledClis(executors, profiles).map((cli) => {
    const conn = connByExecutor.get(cli.id);
    const connectLinked = cli.kind === "connect" && Boolean(conn);
    const statusLabel = resolveStatusLabel(cli, conn?.lastHeartbeatAt, connectLinked);
    const available = cli.available || connectLinked;
    return {
      ...cli,
      available,
      connectLinked,
      lastHeartbeatAt: conn?.lastHeartbeatAt,
      statusLabel,
      statusTone: resolveStatusTone(cli, available, connectLinked),
    };
  });
}

function resolveStatusTone(
  cli: CliEntry,
  available: boolean,
  connectLinked: boolean,
): ConsoleAgentStatusTone {
  if (available) return "ok";
  if (cli.kind === "connect" && !connectLinked) return "off";
  return "warn";
}

function resolveStatusLabel(
  cli: CliEntry,
  lastHeartbeatAt: string | undefined,
  connectLinked: boolean,
): string {
  if (cli.kind === "connect") {
    if (connectLinked && lastHeartbeatAt) {
      return `Connect 已连接 · 心跳 ${formatHeartbeat(lastHeartbeatAt)}`;
    }
    if (cli.available) {
      return "Connect 已连接";
    }
    return cli.hint ?? "未连接 · 需启动 Connect 客户端并保持心跳";
  }
  if (cli.kind === "acp" && cli.available) {
    return "本机就绪 · 派单时由 OpenX 启动";
  }
  if (cli.kind === "pi" && cli.available) {
    return "内嵌在线 · 本机 Pi 底座";
  }
  return cli.hint ?? "不可用";
}

export function consoleAgentSummary(rows: ConsoleAgentRow[], connectCount: number): string {
  const available = rows.filter((r) => r.available).length;
  return `${available} 个可用 · ${connectCount} 个 Connect 已连接`;
}

export function consoleAgentKindBadge(kind: CliEntry["kind"]): string {
  return cliKindLabel(kind);
}
