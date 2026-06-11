import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildConnectBootstrapCommand,
  buildConnectClientArgv,
  type CliProfile,
  type ConnectBootstrapStatus,
} from "@openx/shared";
import { getOpenxSkillsDir } from "@openx/shared/skills-path";
import { getConnectionByExecutorId } from "./connect-store.js";
import { resolveNodeForMcp } from "./mcp-openx-bootstrap.js";

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
  return { ...result, status, online: status.online };
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
