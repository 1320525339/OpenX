import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import {
  DEFAULT_MILOCO_PRESENCE_INTERVAL_MS,
  OPENX_MILOCO_PRESENCE_INTERVAL_ENV,
  OPENX_MILOCO_PRESENCE_WATCH_ENV,
  type MilocoPresenceChange,
  type MilocoPresenceConfig,
  type MilocoPresenceState,
} from "@openx/shared";
import { handleMilocoAgentTurn } from "./miloco-webhook-service.js";
import { loadMilocoUserConfig } from "./miloco-config.js";
import { runMilocoWslCliAsync } from "./miloco-cli-runner.js";
import {
  getMilocoPresenceConfigPath,
  getMilocoPresenceStatePath,
  getOpenxHome,
} from "./paths.js";

function presenceConfigPath(): string {
  return getMilocoPresenceConfigPath();
}

function presenceStatePath(): string {
  return getMilocoPresenceStatePath();
}

export type MilocoDeviceRow = {
  did: string;
  name: string;
  room: string;
  category: string;
  online: boolean;
};

export type MilocoPresenceRunSummary = {
  ranAt: string;
  deviceCount: number;
  watchedCount: number;
  changes: MilocoPresenceChange[];
  triggered: boolean;
  baselineReady: boolean;
  error?: string;
};

export type MilocoPresenceStatus = {
  enabled: boolean;
  intervalMs: number;
  configPath: string;
  statePath: string;
  watchDids: string[];
  baselineReady: boolean;
  lastPollAt?: string;
  lastDiff?: MilocoPresenceChange[];
  lastError?: string;
};

let timer: ReturnType<typeof setInterval> | undefined;
let lastDiff: MilocoPresenceChange[] | undefined;
let lastError: string | undefined;
let inflight = false;

/** 解析 device list TSV 行（支持 \\\| 转义） */
export function splitDeviceListField(line: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "|" && line[i - 1] !== "\\") {
      parts.push(current.replace(/\\\|/g, "|"));
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current.replace(/\\\|/g, "|"));
  return parts;
}

/** 瑙ｆ瀽 miloco-cli device list stdout */
export function parseDeviceListOutput(stdout: string): MilocoDeviceRow[] {
  const rows: MilocoDeviceRow[] = [];
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = splitDeviceListField(line);
    if (parts.length < 5) continue;
    const [did, name, room, category, onlineRaw] = parts;
    if (!did) continue;
    rows.push({
      did,
      name: name ?? "",
      room: room ?? "",
      category: category ?? "",
      online: onlineRaw === "online",
    });
  }
  return rows;
}

export function resolveMilocoPresenceIntervalMs(): number {
  const raw = process.env[OPENX_MILOCO_PRESENCE_INTERVAL_ENV]?.trim();
  if (!raw) return DEFAULT_MILOCO_PRESENCE_INTERVAL_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 60_000) {
    return DEFAULT_MILOCO_PRESENCE_INTERVAL_MS;
  }
  return parsed;
}

export function isMilocoPresenceWatchEnabled(): boolean {
  return process.env[OPENX_MILOCO_PRESENCE_WATCH_ENV] === "1";
}

function defaultPresenceConfig(): MilocoPresenceConfig {
  const user = loadMilocoUserConfig();
  return {
    homeId: user.homeId,
    watchDids: [...(user.watchDids ?? [])],
    notifyOn: ["online", "offline"],
  };
}

export function ensureMilocoPresenceConfig(): MilocoPresenceConfig {
  mkdirSync(getOpenxHome(), { recursive: true });
  const user = loadMilocoUserConfig();

  // 优先用户配置；兼容旧 miloco-presence.json
  if (user.homeId || user.watchDids.length > 0) {
    const config: MilocoPresenceConfig = {
      homeId: user.homeId,
      watchDids: [...user.watchDids],
      notifyOn: ["online", "offline"],
    };
    if (!existsSync(presenceConfigPath())) {
      writeFileSync(presenceConfigPath(), `${JSON.stringify(config, null, 2)}\n`, "utf8");
    }
    return config;
  }

  if (!existsSync(presenceConfigPath())) {
    const config = defaultPresenceConfig();
    writeFileSync(presenceConfigPath(), `${JSON.stringify(config, null, 2)}\n`, "utf8");
    return config;
  }
  try {
    const parsed = JSON.parse(readFileSync(presenceConfigPath(), "utf8")) as Partial<MilocoPresenceConfig>;
    return {
      homeId: parsed.homeId,
      watchDids: parsed.watchDids?.length ? parsed.watchDids : [],
      notifyOn: parsed.notifyOn?.length ? parsed.notifyOn : ["online", "offline"],
    };
  } catch {
    return defaultPresenceConfig();
  }
}

function loadPresenceState(): MilocoPresenceState {
  if (!existsSync(presenceStatePath())) {
    return { baselineReady: false, devices: {} };
  }
  try {
    const parsed = JSON.parse(readFileSync(presenceStatePath(), "utf8")) as MilocoPresenceState;
    return {
      baselineReady: parsed.baselineReady === true,
      lastPollAt: parsed.lastPollAt,
      devices: parsed.devices ?? {},
    };
  } catch {
    return { baselineReady: false, devices: {} };
  }
}

function savePresenceState(state: MilocoPresenceState): void {
  mkdirSync(getOpenxHome(), { recursive: true });
  writeFileSync(presenceStatePath(), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function computePresenceDiff(
  previous: MilocoPresenceState,
  currentDevices: MilocoDeviceRow[],
  config: MilocoPresenceConfig,
): MilocoPresenceChange[] {
  const changes: MilocoPresenceChange[] = [];
  const currentByDid = new Map(currentDevices.map((d) => [d.did, d]));

  for (const did of config.watchDids) {
    const device = currentByDid.get(did);
    if (!device) continue;
    const prev = previous.devices[did]?.online;
    if (prev === undefined) continue;
    if (prev === device.online) continue;

    const event: "online" | "offline" = device.online ? "online" : "offline";
    if (!config.notifyOn.includes(event)) continue;

    changes.push({
      did,
      name: device.name || previous.devices[did]?.name || did,
      from: prev,
      to: device.online,
    });
  }

  return changes;
}

function buildPresenceStateFromDevices(
  devices: MilocoDeviceRow[],
  watchDids: string[],
  previous?: MilocoPresenceState,
): MilocoPresenceState["devices"] {
  const out: MilocoPresenceState["devices"] = {};
  const byDid = new Map(devices.map((d) => [d.did, d]));
  for (const did of watchDids) {
    const device = byDid.get(did);
    if (device) {
      out[did] = { online: device.online, name: device.name };
    } else if (previous?.devices[did]) {
      out[did] = previous.devices[did]!;
    }
  }
  return out;
}

function formatPresenceMessage(changes: MilocoPresenceChange[]): string {
  const lines = changes.map((c) => {
    const fromLabel = c.from ? "online" : "offline";
    const toLabel = c.to ? "online" : "offline";
    return `设备状态变化：${c.name}(${c.did}) ${fromLabel} → ${toLabel}`;
  });
  return [
    "[设备在线监测]",
    ...lines,
    "请用 miloco-notify 向用户推送简短中文提醒，并可选列出同家庭其他离线设备。",
  ].join("\n");
}

export async function runMilocoDeviceListCli(): Promise<{
  ok: boolean;
  stdout: string;
  stderr: string;
}> {
  const result = await runMilocoWslCliAsync(["device", "list"], { timeoutMs: 45_000 });
  return {
    ok: result.ok,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function triggerPresenceAgentTurn(changes: MilocoPresenceChange[]): Promise<void> {
  const traceId = `presence-${Date.now()}`;
  const message = formatPresenceMessage(changes);
  await handleMilocoAgentTurn({
    message,
    sessionKey: "agent:main:miloco-suggest",
    lane: "miloco-suggest",
    traceId,
    idempotencyKey: traceId,
    timeoutMs: 180_000,
    wait: false,
  });
}

export function getMilocoPresenceStatus(): MilocoPresenceStatus {
  const config = ensureMilocoPresenceConfig();
  const state = loadPresenceState();
  return {
    enabled: isMilocoPresenceWatchEnabled(),
    intervalMs: resolveMilocoPresenceIntervalMs(),
    configPath: presenceConfigPath(),
    statePath: presenceStatePath(),
    watchDids: config.watchDids,
    baselineReady: state.baselineReady,
    lastPollAt: state.lastPollAt,
    lastDiff,
    lastError,
  };
}

export async function runMilocoPresenceOnce(): Promise<MilocoPresenceRunSummary> {
  if (inflight) {
    return {
      ranAt: new Date().toISOString(),
      deviceCount: 0,
      watchedCount: 0,
      changes: [],
      triggered: false,
      baselineReady: loadPresenceState().baselineReady,
      error: "poll already in progress",
    };
  }

  inflight = true;
  const ranAt = new Date().toISOString();
  const config = ensureMilocoPresenceConfig();
  const previous = loadPresenceState();

  try {
    if (!config.watchDids.length) {
      return {
        ranAt,
        deviceCount: 0,
        watchedCount: 0,
        changes: [],
        triggered: false,
        baselineReady: previous.baselineReady,
        error: "未配置监测设备（请完成接入向导）",
      };
    }

    const cli = await runMilocoDeviceListCli();
    if (!cli.ok) {
      const error = cli.stderr || cli.stdout || "miloco-cli device list failed";
      lastError = error;
      return {
        ranAt,
        deviceCount: 0,
        watchedCount: config.watchDids.length,
        changes: [],
        triggered: false,
        baselineReady: previous.baselineReady,
        error,
      };
    }

    const devices = parseDeviceListOutput(cli.stdout);
    const nextDevices = buildPresenceStateFromDevices(devices, config.watchDids, previous);
    const changes = previous.baselineReady
      ? computePresenceDiff(previous, devices, config)
      : [];

    const nextState: MilocoPresenceState = {
      baselineReady: true,
      lastPollAt: ranAt,
      devices: nextDevices,
    };
    savePresenceState(nextState);
    lastDiff = changes.length ? changes : undefined;
    lastError = undefined;

    let triggered = false;
    if (changes.length > 0) {
      triggered = true;
      void triggerPresenceAgentTurn(changes).catch((err) => {
        lastError = err instanceof Error ? err.message : String(err);
      });
    }

    return {
      ranAt,
      deviceCount: devices.length,
      watchedCount: config.watchDids.length,
      changes,
      triggered,
      baselineReady: true,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    lastError = error;
    return {
      ranAt,
      deviceCount: 0,
      watchedCount: config.watchDids.length,
      changes: [],
      triggered: false,
      baselineReady: previous.baselineReady,
      error,
    };
  } finally {
    inflight = false;
  }
}

export function startMilocoPresenceWatchdog(): void {
  if (!isMilocoPresenceWatchEnabled() || timer) return;
  const config = ensureMilocoPresenceConfig();
  if (!config.watchDids.length) {
    console.log("[miloco] 设备在线监测未配置 watchDids，watchdog 保持 idle");
    return;
  }
  const intervalMs = resolveMilocoPresenceIntervalMs();
  void runMilocoPresenceOnce();
  timer = setInterval(() => {
    void runMilocoPresenceOnce();
  }, intervalMs);
  if (typeof timer === "object" && "unref" in timer) {
    timer.unref();
  }
}

export function stopMilocoPresenceWatchdog(): void {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}

/** 测试用：重置内存状态 */
export function resetMilocoPresenceWatchdogForTests(): void {
  stopMilocoPresenceWatchdog();
  lastDiff = undefined;
  lastError = undefined;
  inflight = false;
}
