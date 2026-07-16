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
  resolveProvidersForLoad,
  writeProvidersToDisk,
} from "./providers-store.js";
import {
  readPersistCommitMarker,
  writePersistCommitMarker,
} from "./persist-commit.js";

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

function normalizeSettingsInMemory(settings: Settings): Settings {
  const providers =
    Object.keys(settings.providers ?? {}).length > 0
      ? settings.providers!
      : resolveProvidersForLoad();
  const upgraded = upgradeToModelConfig({ ...settings, providers });
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
  const { providers: _legacy, coach: _coach, ...coreRaw } = raw;
  const parsed = SettingsSchema.parse({
    ...DEFAULT_SETTINGS,
    ...coreRaw,
    providers: {},
  });
  const providers = resolveProvidersForLoad(legacyProviders);
  return { ...parsed, providers };
}

function needsPersistMigration(before: Settings, after: Settings): boolean {
  if (before.workspaceRoot !== after.workspaceRoot) return true;
  if (before.systemWorkspaceRoot !== after.systemWorkspaceRoot) return true;
  if (JSON.stringify(before.mcpServers) !== JSON.stringify(after.mcpServers)) return true;
  return needsProvidersFileMigration(before.providers);
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
  if (
    Object.keys(providersOnDisk).length === 0 &&
    Object.keys(normalized.providers ?? {}).length > 0
  ) {
    writeProvidersToDisk(normalized.providers ?? {});
    writePersistCommitMarker(normalized.revision ?? 0);
  } else if (marker && marker.revision !== (normalized.revision ?? 0)) {
    console.warn(
      `[settings] persist-commit 与 config revision 不一致 (marker=${marker.revision}, config=${normalized.revision ?? 0})，以 config 为准并对账 providers`,
    );
    writeProvidersToDisk(normalized.providers ?? {});
    writePersistCommitMarker(normalized.revision ?? 0);
  }
  syncSystemWorkspaceLayout(normalized);
  return normalized;
}

/** API 响应用：脱敏 providers 中的明文 apiKey */
export function settingsForApi(settings: Settings): Settings {
  return sanitizeSettingsForApi(settings);
}

export function loadSettings(): Settings {
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

  writeProvidersToDisk(withRevision.providers ?? {});
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
