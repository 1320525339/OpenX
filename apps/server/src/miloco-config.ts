import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { getMilocoConfigPath, getOpenxHome } from "./paths.js";

/** 用户级 Miloco 接入配置（OPENX_HOME/miloco-config.json） */
export type MilocoUserConfig = {
  homeId?: string;
  homeName?: string;
  watchDids: string[];
  enabledCameraDids?: string[];
  dashboardUrl?: string;
  webhookHost?: string;
  timezone?: string;
  cronTasks?: Array<{
    name: string;
    cronExpr: string;
    enabled?: boolean;
  }>;
  setupCompletedAt?: string;
};

/** @deprecated 使用 getMilocoConfigPath()；模块加载时求值，测试改 env 后可能过期 */
export const MILOCO_CONFIG_PATH = getMilocoConfigPath();

export function emptyMilocoUserConfig(): MilocoUserConfig {
  return {
    watchDids: [],
    enabledCameraDids: [],
    dashboardUrl: "http://127.0.0.1:1810/",
    timezone: "Asia/Shanghai",
  };
}

export function loadMilocoUserConfig(): MilocoUserConfig {
  const path = getMilocoConfigPath();
  if (!existsSync(path)) {
    return emptyMilocoUserConfig();
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<MilocoUserConfig>;
    return {
      ...emptyMilocoUserConfig(),
      ...parsed,
      watchDids: Array.isArray(parsed.watchDids) ? parsed.watchDids.map(String) : [],
      enabledCameraDids: Array.isArray(parsed.enabledCameraDids)
        ? parsed.enabledCameraDids.map(String)
        : [],
    };
  } catch {
    return emptyMilocoUserConfig();
  }
}

export function saveMilocoUserConfig(patch: Partial<MilocoUserConfig>): MilocoUserConfig {
  mkdirSync(getOpenxHome(), { recursive: true });
  const current = loadMilocoUserConfig();
  const next: MilocoUserConfig = {
    ...current,
    ...patch,
    watchDids: patch.watchDids ?? current.watchDids,
    enabledCameraDids: patch.enabledCameraDids ?? current.enabledCameraDids,
  };
  writeFileSync(getMilocoConfigPath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function isMilocoSetupComplete(config = loadMilocoUserConfig()): boolean {
  return Boolean(config.setupCompletedAt && config.homeId && config.watchDids.length > 0);
}
