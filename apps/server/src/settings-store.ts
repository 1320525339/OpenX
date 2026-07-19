import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  SettingsSchema,
  DEFAULT_SETTINGS,
  upgradeToModelConfig,
  stripProvidersForCoreConfigSave,
  ensureOpenxMcpServer,
  isDefaultZenModelSection,
  mergeSettingsForSave,
  mergeSettingsPatch,
  sanitizeSettingsForApi,
  type Settings,
  type ProvidersMap,
} from "@openx/shared";
import { getConfigPath } from "./paths.js";
import { normalizeWorkspaceRootForStorage } from "./workspace-path.js";
import { syncSystemWorkspaceLayout } from "./system-workspace-path.js";
import { resolveMcpOpenxScript, resolveNodeForMcp } from "./mcp-openx-bootstrap.js";
import { atomicWriteJson } from "./atomic-json.js";
import {
  needsProvidersFileMigration,
  readProvidersFromDisk,
  readProvidersRevisionFromDisk,
  resolveProvidersForLoad,
  writeProvidersToDisk,
} from "./providers-store.js";
import {
  readPersistCommitMarker,
  writePersistCommitMarker,
} from "./persist-commit.js";
import { syncOpenxDotEnv } from "./openx-dotenv.js";
import { getSecretStore } from "./secrets-store.js";

let migrationsChecked = false;

export class SettingsRevisionConflictError extends Error {
  readonly currentRevision: number;

  constructor(currentRevision: number) {
    super(`配置已被其他进程更新（当前 revision=${currentRevision}）`);
    this.name = "SettingsRevisionConflictError";
    this.currentRevision = currentRevision;
  }
}

function withNormalizedSystemWorkspace(settings: Settings): Settings {
  const root = settings.systemWorkspaceRoot?.trim();
  if (!root || root === ".") return settings;
  const normalized = path.isAbsolute(root)
    ? path.normalize(root)
    : normalizeWorkspaceRootForStorage(root);
  if (normalized === settings.systemWorkspaceRoot) return settings;
  return { ...settings, systemWorkspaceRoot: normalized };
}

function withNormalizedWorkspaceRoot(settings: Settings): Settings {
  const root = settings.workspaceRoot?.trim() || ".";
  const normalized = path.isAbsolute(root)
    ? path.normalize(root)
    : normalizeWorkspaceRootForStorage(root);
  if (normalized === settings.workspaceRoot) return settings;
  return { ...settings, workspaceRoot: normalized };
}

function withBuiltinMcpServers(settings: Settings): Settings {
  try {
    const script = resolveMcpOpenxScript();
    const nextServers = ensureOpenxMcpServer(settings.mcpServers ?? [], script, {
      nodePath: resolveNodeForMcp(),
    });
    if (JSON.stringify(nextServers) === JSON.stringify(settings.mcpServers ?? [])) {
      return settings;
    }
    return { ...settings, mcpServers: nextServers };
  } catch {
    return settings;
  }
}

function warnDeprecatedSettingsFields(settings: Settings): void {
  if (process.env.OPENX_DEPRECATION_WARN === "0") return;
  if (settings.coach) {
    console.warn(
      "[settings] 废弃字段 coach 仍存在：已自动迁移到 model + providers，下次 major 将移除读兼容",
    );
  }
  if (settings.workspaceRoot && settings.workspaceRoot !== "." && !settings.systemWorkspaceRoot?.trim()) {
    console.warn(
      "[settings] 废弃字段 workspaceRoot：请改用 systemWorkspaceRoot（下次 major 将仅保留 systemWorkspaceRoot）",
    );
  }
}

function normalizeSettingsInMemory(settings: Settings): Settings {
  let providers = settings.providers ?? {};
  if (Object.keys(providers).length === 0) {
    if (settings.coach) {
      // 保留空池，交给 upgradeToModelConfig 从扁平 coach 生成
      providers = {};
    } else {
      providers = resolveProvidersForLoad();
    }
  }
  const upgraded = upgradeToModelConfig({ ...settings, providers });
  warnDeprecatedSettingsFields(settings);
  const base = { ...upgraded, defaultExecutorId: settings.defaultExecutorId ?? "pi" };
  return withBuiltinMcpServers(
    withNormalizedSystemWorkspace(withNormalizedWorkspaceRoot(base)),
  );
}

function readLegacyProviders(raw: Record<string, unknown>): ProvidersMap | undefined {
  if (!raw.providers || typeof raw.providers !== "object") return undefined;
  try {
    return SettingsSchema.shape.providers.parse(raw.providers);
  } catch {
    return undefined;
  }
}

function readSettingsFromDisk(): Settings | null {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) return null;

  const raw = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
  const legacyProviders = readLegacyProviders(raw);
  const legacyCoach =
    raw.coach && typeof raw.coach === "object"
      ? (raw.coach as Settings["coach"])
      : undefined;
  const { providers: _legacy, coach: _coach, ...coreRaw } = raw;
  const parsed = SettingsSchema.parse({
    ...DEFAULT_SETTINGS,
    ...coreRaw,
    providers: {},
    ...(legacyCoach ? { coach: legacyCoach } : {}),
  });

  const fromFile = readProvidersFromDisk();
  let providers: ProvidersMap;
  if (Object.keys(fromFile).length > 0) {
    providers = fromFile;
  } else if (legacyProviders && Object.keys(legacyProviders).length > 0) {
    providers = legacyProviders;
  } else if (legacyCoach) {
    // 留给 upgradeToModelConfig 从扁平 coach 生成渠道，勿填默认 zen
    providers = {};
  } else {
    providers = resolveProvidersForLoad();
  }

  return {
    ...parsed,
    providers,
    ...(legacyCoach ? { coach: legacyCoach } : {}),
  };
}

function needsPersistMigration(before: Settings, after: Settings): boolean {
  if (before.workspaceRoot !== after.workspaceRoot) return true;
  if (before.systemWorkspaceRoot !== after.systemWorkspaceRoot) return true;
  if (JSON.stringify(before.mcpServers) !== JSON.stringify(after.mcpServers)) return true;
  if (needsProvidersFileMigration(before.providers)) return true;
  // 从扁平 coach 升级出了渠道 → 需要落盘 providers.json
  if (
    before.coach &&
    Object.keys(before.providers ?? {}).length === 0 &&
    Object.keys(after.providers ?? {}).length > 0
  ) {
    return true;
  }
  return false;
}

function assertRevision(current: Settings, baseRevision?: number): void {
  if (baseRevision === undefined) return;
  const revision = current.revision ?? 0;
  if (baseRevision !== revision) {
    throw new SettingsRevisionConflictError(revision);
  }
}

function bumpRevision(settings: Settings): Settings {
  return { ...settings, revision: (settings.revision ?? 0) + 1 };
}

/** 启动时一次性迁移（路径规范化、内置 MCP、providers.json） */
export function runSettingsMigrations(): Settings {
  migrationsChecked = true;
  const raw = readSettingsFromDisk();
  const parsed = raw ?? SettingsSchema.parse({});
  const normalized = normalizeSettingsInMemory(parsed);
  if (!raw || needsPersistMigration(parsed, normalized)) {
    return saveSettings(normalized);
  }
  // 跨文件对账：config 有 revision 但 providers 缺失时补写
  const marker = readPersistCommitMarker();
  const providersOnDisk = readProvidersFromDisk();
  const providersRevision = readProvidersRevisionFromDisk();
  const configRevision = normalized.revision ?? 0;
  if (
    Object.keys(providersOnDisk).length === 0 &&
    Object.keys(normalized.providers ?? {}).length > 0
  ) {
    writeProvidersToDisk(normalized.providers ?? {}, configRevision);
    writePersistCommitMarker(configRevision);
  } else if (
    marker && marker.revision !== configRevision
  ) {
    console.warn(
      `[settings] persist-commit 与 config revision 不一致 (marker=${marker.revision}, config=${configRevision})，以 config 为准并对账 providers`,
    );
    writeProvidersToDisk(normalized.providers ?? {}, configRevision);
    writePersistCommitMarker(configRevision);
  } else if (
    providersRevision !== null &&
    providersRevision !== configRevision &&
    Object.keys(normalized.providers ?? {}).length > 0
  ) {
    console.warn(
      `[settings] providers.json revision=${providersRevision} 与 config revision=${configRevision} 不一致，以 config 为准重写`,
    );
    writeProvidersToDisk(normalized.providers ?? {}, configRevision);
    writePersistCommitMarker(configRevision);
  }
  syncSystemWorkspaceLayout(normalized);
  return normalized;
}

/** API 响应用：脱敏 providers 中的明文 apiKey，并标注是否已配置密钥 */
export function settingsForApi(settings: Settings): Settings {
  const store = getSecretStore();
  return sanitizeSettingsForApi(settings, {
    hasSecret: (envKey) => Boolean(store.get(envKey)?.trim()),
  });
}

export function loadSettings(): Settings {
  // 每次读配置前把 ~/.openx/.env 刷进 process.env，保证设置页改 Key 后无需重启即可生效
  syncOpenxDotEnv();

  if (!migrationsChecked) {
    return runSettingsMigrations();
  }

  try {
    const raw = readSettingsFromDisk();
    if (!raw) {
      const base = normalizeSettingsInMemory(
        SettingsSchema.parse({ ...DEFAULT_SETTINGS, providers: {} }),
      );
      syncSystemWorkspaceLayout(base);
      return base;
    }
    const normalized = normalizeSettingsInMemory(raw);
    syncSystemWorkspaceLayout(normalized);
    return normalized;
  } catch (err) {
    console.error("[settings] 加载配置失败，回退默认值（不写入磁盘）:", err);
    const base = normalizeSettingsInMemory(
      SettingsSchema.parse({ ...DEFAULT_SETTINGS, providers: {} }),
    );
    syncSystemWorkspaceLayout(base);
    return base;
  }
}

export function saveSettings(settings: Settings, opts?: { baseRevision?: number }): Settings {
  const current = loadSettings();
  assertRevision(current, opts?.baseRevision);

  const parsed = SettingsSchema.parse(settings);
  const modelFromInput = parsed.model;
  let normalized = normalizeSettingsInMemory({
    ...parsed,
    defaultExecutorId: parsed.defaultExecutorId ?? "pi",
  });
  // 落盘时保留调用方显式传入的自定义 model，避免 upgrade 因瞬时渠道缺失回写 zen
  if (
    modelFromInput &&
    !isDefaultZenModelSection(modelFromInput) &&
    isDefaultZenModelSection(normalized.model)
  ) {
    normalized = { ...normalized, model: modelFromInput };
  }
  const withRevision = bumpRevision({ ...normalized, revision: current.revision ?? 0 });

  writeProvidersToDisk(withRevision.providers ?? {}, withRevision.revision ?? 0);
  const core = stripProvidersForCoreConfigSave(withRevision) as Settings;
  atomicWriteJson(getConfigPath(), core);
  writePersistCommitMarker(withRevision.revision ?? 0);
  syncSystemWorkspaceLayout(withRevision);

  return withRevision;
}

export function patchSettings(
  patch: Partial<Settings>,
  opts?: { baseRevision?: number },
): Settings {
  const current = loadSettings();
  return saveSettings(mergeSettingsPatch(current, patch), opts);
}

export function mergeAndSaveSettings(
  incoming: Settings,
  opts?: { baseRevision?: number },
): Settings {
  const current = loadSettings();
  const safeIncoming = mergeSettingsForSave(current, incoming);
  return saveSettings(mergeSettingsPatch(current, safeIncoming), opts);
}

/** 供测试或诊断：providers.json 是否已分离 */
export function isProvidersFileActive(): boolean {
  return Object.keys(readProvidersFromDisk()).length > 0;
}
