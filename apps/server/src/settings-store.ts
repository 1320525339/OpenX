import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { dirname } from "node:path";
import {
  SettingsSchema,
  DEFAULT_SETTINGS,
  upgradeToModelConfig,
  stripLegacyCoachForSave,
  ensureOpenxMcpServer,
  type Settings,
} from "@openx/shared";
import { CONFIG_PATH } from "./paths.js";
import { normalizeWorkspaceRootForStorage } from "./workspace-path.js";
import { syncSystemWorkspaceLayout } from "./system-workspace-path.js";
import { resolveMcpOpenxScript, resolveNodeForMcp } from "./mcp-openx-bootstrap.js";

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
    if (nextServers.length === (settings.mcpServers ?? []).length) {
      return settings;
    }
    return { ...settings, mcpServers: nextServers };
  } catch {
    return settings;
  }
}

export function loadSettings(): Settings {
  try {
    if (!existsSync(CONFIG_PATH)) {
      const base = withBuiltinMcpServers(upgradeToModelConfig({ ...DEFAULT_SETTINGS }));
      syncSystemWorkspaceLayout(base);
      return base;
    }
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Record<string, unknown>;
    const parsed = SettingsSchema.parse({ ...DEFAULT_SETTINGS, ...raw });
    const upgraded = upgradeToModelConfig(parsed);
    const base = { ...upgraded, defaultExecutorId: parsed.defaultExecutorId ?? "pi" };
    const normalized = withNormalizedSystemWorkspace(withNormalizedWorkspaceRoot(base));
    const withMcp = withBuiltinMcpServers(normalized);
    if (
      normalized.workspaceRoot !== base.workspaceRoot ||
      normalized.systemWorkspaceRoot !== base.systemWorkspaceRoot
    ) {
      return saveSettings(withMcp);
    }
    const openxChanged =
      JSON.stringify(withMcp.mcpServers) !== JSON.stringify(normalized.mcpServers);
    if (openxChanged) {
      return saveSettings(withMcp);
    }
    syncSystemWorkspaceLayout(withMcp);
    return withMcp;
  } catch (err) {
    console.error("[settings] 加载配置失败，回退默认值:", err);
    const base = withBuiltinMcpServers(upgradeToModelConfig({ ...DEFAULT_SETTINGS }));
    syncSystemWorkspaceLayout(base);
    return base;
  }
}

export function saveSettings(settings: Settings): Settings {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });

  const parsed = SettingsSchema.parse(settings);
  const upgraded = upgradeToModelConfig(parsed);
  const normalized = withBuiltinMcpServers({
    ...withNormalizedSystemWorkspace(withNormalizedWorkspaceRoot(upgraded)),
    defaultExecutorId: parsed.defaultExecutorId ?? "pi",
  });

  const toSave = stripLegacyCoachForSave(normalized) as Settings;
  writeFileSync(CONFIG_PATH, JSON.stringify(toSave, null, 2), "utf8");
  syncSystemWorkspaceLayout(normalized);

  return normalized;
}
