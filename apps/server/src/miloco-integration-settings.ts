import { existsSync } from "node:fs";
import {
  MILOCO_SYNC_SKILL_IDS,
  parseIntegrationEnvFlag,
  type IntegrationUserSettings,
  type Settings,
} from "@openx/shared";
import { loadSettings, saveSettings } from "./settings-store.js";
import { loadMilocoUserConfig } from "./miloco-config.js";
import {
  getMilocoConfigPath,
  getMilocoMemoryDir,
  getMilocoPresenceConfigPath,
  getMilocoWebhookTokenPath,
} from "./paths.js";

/** 检测是否存在旧版 Miloco 使用痕迹（任一即可触发迁移启用） */
export function detectLegacyMilocoArtifacts(settings: Settings): boolean {
  if (existsSync(getMilocoWebhookTokenPath())) return true;
  if (existsSync(getMilocoPresenceConfigPath())) return true;
  if (existsSync(getMilocoConfigPath())) {
    const cfg = loadMilocoUserConfig();
    if (cfg.homeId || cfg.watchDids.length > 0 || cfg.setupCompletedAt) return true;
  }
  if (existsSync(getMilocoMemoryDir())) return true;
  const bindings = settings.skillBindings ?? {};
  for (const id of MILOCO_SYNC_SKILL_IDS) {
    const b = bindings[id];
    if (b?.enabled && b.cliIds?.includes("pi")) return true;
  }
  return false;
}

/**
 * 一次性迁移：旧配置存在 → 启用；否则默认关闭。
 * 显式 OPENX_MILOCO 不在此写入 settings（运行时覆盖）。
 */
export function migrateMilocoIntegrationSettings(): Settings {
  const settings = loadSettings();
  const current = settings.integrations?.miloco;
  if (current?.migrationCompleted) {
    return settings;
  }

  const shouldEnable = detectLegacyMilocoArtifacts(settings);
  const userCfg = loadMilocoUserConfig();
  const entry: IntegrationUserSettings = {
    enabled: shouldEnable,
    migrationCompleted: true,
    config: {
      ...(current?.config ?? {}),
      ...(userCfg.homeId ? { homeId: userCfg.homeId } : {}),
      ...(userCfg.homeName ? { homeName: userCfg.homeName } : {}),
      watchDids: userCfg.watchDids ?? [],
      dashboardUrl: userCfg.dashboardUrl ?? "http://127.0.0.1:1810/",
      timezone: userCfg.timezone ?? "Asia/Shanghai",
    },
  };

  const next: Settings = {
    ...settings,
    integrations: {
      ...(settings.integrations ?? {}),
      miloco: entry,
    },
  };
  saveSettings(next);
  console.log(
    `[miloco] 集成迁移完成：${shouldEnable ? "已启用（检测到旧配置）" : "默认关闭"}`,
  );
  return next;
}

/** 解析 Miloco 是否启用：env 显式覆盖 settings */
export function resolveMilocoEnabled(settings = loadSettings()): {
  enabled: boolean;
  envLocked: boolean;
  reason?: string;
} {
  const envFlag = parseIntegrationEnvFlag(process.env.OPENX_MILOCO);
  if (envFlag !== undefined) {
    return {
      enabled: envFlag,
      envLocked: true,
      reason: envFlag
        ? "已由环境变量 OPENX_MILOCO=1 强制启用"
        : "已由环境变量 OPENX_MILOCO=0 强制停用",
    };
  }
  // Watchdog env 不再隐式启用集成；仅当 settings/OPENX_MILOCO 已启用时由插件启动 watchdog
  return {
    enabled: settings.integrations?.miloco?.enabled === true,
    envLocked: false,
  };
}
