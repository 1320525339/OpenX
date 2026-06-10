import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { dirname } from "node:path";
import {
  SettingsSchema,
  DEFAULT_SETTINGS,
  upgradeToModelConfig,
  stripLegacyCoachForSave,
  type Settings,
} from "@openx/shared";
import { CONFIG_PATH } from "./paths.js";
import { normalizeWorkspaceRootForStorage } from "./workspace-path.js";

function withNormalizedWorkspaceRoot(settings: Settings): Settings {
  const root = settings.workspaceRoot?.trim() || ".";
  const normalized = path.isAbsolute(root)
    ? path.normalize(root)
    : normalizeWorkspaceRootForStorage(root);
  if (normalized === settings.workspaceRoot) return settings;
  return { ...settings, workspaceRoot: normalized };
}

export function loadSettings(): Settings {
  try {
    if (!existsSync(CONFIG_PATH)) {
      return upgradeToModelConfig({ ...DEFAULT_SETTINGS });
    }
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Record<string, unknown>;
    const parsed = SettingsSchema.parse({ ...DEFAULT_SETTINGS, ...raw });
    const upgraded = upgradeToModelConfig(parsed);
    const base = { ...upgraded, defaultExecutorId: parsed.defaultExecutorId ?? "pi" };
    const normalized = withNormalizedWorkspaceRoot(base);
    if (normalized.workspaceRoot !== base.workspaceRoot) {
      return saveSettings(normalized);
    }
    return normalized;
  } catch (err) {
    console.error("[settings] 加载配置失败，回退默认值:", err);
    return upgradeToModelConfig({ ...DEFAULT_SETTINGS });
  }
}



export function saveSettings(settings: Settings): Settings {

  mkdirSync(dirname(CONFIG_PATH), { recursive: true });

  const parsed = SettingsSchema.parse(settings);

  const upgraded = upgradeToModelConfig(parsed);

  const normalized = { ...upgraded, defaultExecutorId: parsed.defaultExecutorId ?? "pi" };

  const toSave = stripLegacyCoachForSave(normalized) as Settings;

  writeFileSync(CONFIG_PATH, JSON.stringify(toSave, null, 2), "utf8");

  return normalized;

}


