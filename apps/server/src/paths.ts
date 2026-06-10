import { homedir } from "node:os";
import { join } from "node:path";

export const OPENX_DIR = join(homedir(), ".openx");
/** 测试可设 OPENX_DB_PATH=:memory: */
export function getDbPath(): string {
  return process.env.OPENX_DB_PATH ?? join(OPENX_DIR, "openx.db");
}
/** @deprecated 使用 getDbPath() */
export const DB_PATH = getDbPath();
export const CONFIG_PATH = join(OPENX_DIR, "config.json");
export const INTERNAL_TOKEN_PATH = join(OPENX_DIR, "internal.token");
