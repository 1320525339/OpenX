import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildConnectBootstrapCommand,
  buildConnectClientArgv,
  type CliProfile,
  type ConnectBootstrapStatus,
  type Settings,
} from "@openx/shared";
import { getOpenxSkillsDir } from "@openx/shared/skills-path";
import { getConnectionByExecutorId } from "./connect-store.js";
import { resolveNodeForMcp } from "./mcp-openx-bootstrap.js";
import { getServerBaseUrl } from "./server-base-url.js";

const BOOTSTRAP_WAIT_MS = Number(process.env.OPENX_BOOTSTRAP_WAIT_MS ?? 45_000);
const BOOTSTRAP_POLL_MS = 500;

type BootstrapRecord = {
  status: ConnectBootstrapStatus;
  proc?: ChildProcess;
};

const records = new Map<string, BootstrapRecord>();

function idleStatus(executorId: string): ConnectBootstrapStatus {
  return {
    executorId,
    phase: "idle",
    online: Boolean(getConnectionByExecutorId(executorId)),
  };
}

function setStatus(executorId: string, patch: Partial<ConnectBootstrapStatus>): ConnectBootstrapStatus {
  const prev = records.get(executorId)?.status ?? idleStatus(executorId);
  const next: ConnectBootstrapStatus = { ...prev, ...patch, executorId };
  if (getConnectionByExecutorId(executorId)) {
    next.online = true;
    next.phase = "online";
  }
  const rec = records.get(executorId);
  if (rec) rec.status = next;
  else records.set(executorId, { status: next });
  return next;
}

export function syncBootstrapOnlineStatus(executorId: string): ConnectBootstrapStatus {
  const online = Boolean(getConnectionByExecutorId(executorId));
  const rec = records.get(executorId);
  if (!rec) {
    return { executorId, phase: online ? "online" : "idle", online };
  }
  if (online) {
    rec.status = { ...rec.status, online: true, phase: "online" };
  } else if (rec.status.phase === "online") {
    rec.status = { ...rec.status, online: false, phase: rec.proc ? "running" : "idle" };
  }
  return rec.status;
}

export function getConnectBootstrapStatus(executorId: string): ConnectBootstrapStatus | undefined {
  const rec = records.get(executorId);
  if (!rec) {
    const online = Boolean(getConnectionByExecutorId(executorId));
    if (!online) return undefined;
    return { executorId, phase: "online", online: true };
  }
  return syncBootstrapOnlineStatus(executorId);
}

export function listConnectBootstrapStatuses(): ConnectBootstrapStatus[] {
  return [...records.keys()].map((id) => syncBootstrapOnlineStatus(id));
}

export function resolveConnectClientScript(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "../../../packages/connect-client/dist/cli.js"),
    join(here, "../../../../packages/connect-client/dist/cli.js"),
    join(process.cwd(), "packages/connect-client/dist/cli.js"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error("未找到 connect-client，请先执行 pnpm --filter @openx/connect-client build");
}

export function getBootstrapCommand(
  profile: CliProfile,
  baseUrl: string,
  projectRoot?: string,
): string {
  return buildConnectBootstrapCommand({
    executorId: profile.executorId,
    displayName: profile.displayName,
    toolName: profile.toolName,
    baseUrl,
    projectRoot: projectRoot ?? process.cwd(),
    skillsDir: getOpenxSkillsDir(),
    nodePath: resolveNodeForMcp(),
    scriptPath: resolveConnectClientScript(),
  });
}

export type BootstrapConnectResult = {
  command: string;
  pid?: number;
  status: ConnectBootstrapStatus;
  online?: boolean;
  error?: string;
};

export function bootstrapConnectProfile(
  profile: CliProfile,
  baseUrl: string,
): BootstrapConnectResult {
  if (profile.kind !== "connect") {
    throw new Error("仅 Connect 类型 CLI 支持一键自举");
  }

  const executorId = profile.executorId;
  if (getConnectionByExecutorId(executorId)) {
    const status = setStatus(executorId, { phase: "online", online: true });
    return {
      command: getBootstrapCommand(profile, baseUrl),
      status,
      online: true,
    };
  }

  const existing = records.get(executorId)?.proc;
  if (existing && existing.exitCode === null && !existing.killed) {
    const status = syncBootstrapOnlineStatus(executorId);
    return {
      command: getBootstrapCommand(profile, baseUrl),
      pid: existing.pid,
      status,
      online: status.online,
    };
  }

  setStatus(executorId, {
    phase: "spawning",
    online: false,
    startedAt: new Date().toISOString(),
    exitCode: undefined,
    lastError: undefined,
    pid: undefined,
  });

  const script = resolveConnectClientScript();
  const nodePath = resolveNodeForMcp();
  const args = buildConnectClientArgv(script, {
    executorId: profile.executorId,
    displayName: profile.displayName,
    toolName: profile.toolName,
    baseUrl,
  });

  let proc: ChildProcess;
  try {
    proc = spawn(nodePath, args, {
      detached: true,
      stdio: ["ignore", "ignore", "pipe"],
      shell: false,
      env: {
        ...process.env,
        OPENX_SKILLS_DIR: getOpenxSkillsDir(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus(executorId, {
      phase: "exited",
      online: false,
      lastError: message,
    });
    throw new Error(`自举 spawn 失败：${message}`, { cause: err });
  }

  proc.unref();

  proc.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) {
      console.warn(`[connect-bootstrap:${executorId}] ${text}`);
      setStatus(executorId, { lastError: text });
    }
  });
  proc.on("error", (err) => {
    console.warn(`[connect-bootstrap:${executorId}] spawn error: ${err.message}`);
    setStatus(executorId, { phase: "exited", lastError: err.message });
  });

  const rec = records.get(executorId) ?? { status: idleStatus(executorId) };
  rec.proc = proc;
  records.set(executorId, rec);

  const status = setStatus(executorId, {
    phase: "running",
    pid: proc.pid,
    online: false,
  });

  proc.on("exit", (code, signal) => {
    const current = records.get(executorId);
    if (!current) return;
    current.proc = undefined;
    const stillOnline = Boolean(getConnectionByExecutorId(executorId));
    current.status = {
      ...current.status,
      phase: stillOnline ? "online" : "exited",
      online: stillOnline,
      exitCode: code,
      lastError:
        code !== null && code !== 0
          ? `进程退出 code=${code}${signal ? ` signal=${signal}` : ""}`
          : current.status.lastError,
    };
    if (code !== null && code !== 0) {
      console.warn(
        `[connect-bootstrap:${executorId}] exited code=${code} signal=${signal ?? ""}`,
      );
    }
  });

  return {
    command: getBootstrapCommand(profile, baseUrl),
    pid: proc.pid,
    status,
    online: false,
  };
}

export async function bootstrapConnectProfileAndWait(
  profile: CliProfile,
  baseUrl: string,
  waitMs = BOOTSTRAP_WAIT_MS,
): Promise<BootstrapConnectResult> {
  const result = bootstrapConnectProfile(profile, baseUrl);
  if (result.online) return result;

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const status = syncBootstrapOnlineStatus(profile.executorId);
    if (status.online || getConnectionByExecutorId(profile.executorId)) {
      return { ...result, status, online: true };
    }
    if (status.phase === "exited") {
      return { ...result, status, online: false };
    }
    await new Promise((r) => setTimeout(r, BOOTSTRAP_POLL_MS));
  }

  const status = syncBootstrapOnlineStatus(profile.executorId);
  const timedOut = !status.online && status.phase !== "exited";
  if (timedOut) {
    setStatus(profile.executorId, {
      lastError:
        status.lastError ??
        `等待 Agent 注册超时（${waitMs}ms）；进程可能仍在启动，可在工具页重试 bootstrap`,
    });
  }
  return {
    ...result,
    status: syncBootstrapOnlineStatus(profile.executorId),
    online: status.online,
    error: timedOut
      ? syncBootstrapOnlineStatus(profile.executorId).lastError
      : undefined,
  };
}

export function formatBootstrapFailureHint(
  result: BootstrapConnectResult & { error?: string },
): string {
  if (result.online) return "";
  if (result.error?.trim()) return result.error.trim();
  const s = result.status;
  if (s.lastError?.trim()) return s.lastError.trim();
  if (s.phase === "exited") {
    return `connect-client 已退出（code=${s.exitCode ?? "?"}）`;
  }
  if (s.phase === "running" || s.phase === "spawning") {
    return `自举进程已启动（pid=${s.pid ?? "?"}），Agent 尚未注册；请稍后在工具页查看或手动执行启动命令`;
  }
  return "等待 Agent 上线超时";
}

/** 服务启动后为离线 Connect Profile 重新自举（内存态 bootstrap 记录重启后丢失） */
export function rebootstrapOfflineConnectProfiles(settings: Settings): void {
  if (!settings.autoBootstrapConnect) return;
  const baseUrl = getServerBaseUrl();
  for (const profile of settings.cliProfiles ?? []) {
    if (profile.kind !== "connect") continue;
    if (getConnectionByExecutorId(profile.executorId)) continue;
    try {
      bootstrapConnectProfile(profile, baseUrl);
      console.log(`[connect-bootstrap] 启动离线 Agent：${profile.executorId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[connect-bootstrap] 启动 ${profile.executorId} 失败：${message}`);
    }
  }
}

export function warnIfConnectClientMissing(): void {
  try {
    resolveConnectClientScript();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[connect-bootstrap] ${message}。Connect 自举不可用，请执行：pnpm --filter @openx/connect-client build`,
    );
  }
}

/** 测试用 */
export function resetBootstrapProcesses(): void {
  for (const rec of records.values()) {
    if (!rec.proc) continue;
    try {
      rec.proc.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  records.clear();
}
