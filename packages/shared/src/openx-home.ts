import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** 默认本机目录 */
export const DEFAULT_OPENX_DIR = join(homedir(), ".openx");

/**
 * 解析数据根目录（与 apps/server paths 对齐）：
 * OPENX_HOME > OPENX_CONFIG_PATH 父目录 > ~/.openx
 */
export function resolveOpenxHome(): string {
  const home = process.env.OPENX_HOME?.trim();
  if (home) return home;
  const configPath = process.env.OPENX_CONFIG_PATH?.trim();
  if (configPath) return dirname(configPath);
  return DEFAULT_OPENX_DIR;
}
