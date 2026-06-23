import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const OPENX_DIR = join(homedir(), ".openx");

export function getOpenxDir(): string {
  const configPath = process.env.OPENX_CONFIG_PATH?.trim();
  if (configPath) return dirname(configPath);
  return OPENX_DIR;
}
/** 测试可设 OPENX_DB_PATH=:memory: */
export function getDbPath(): string {
  return process.env.OPENX_DB_PATH ?? join(OPENX_DIR, "openx.db");
}
/** @deprecated 使用 getDbPath() */
export const DB_PATH = getDbPath();
/** 测试可设 OPENX_CONFIG_PATH 指向隔离 config.json */
export function getConfigPath(): string {
  return process.env.OPENX_CONFIG_PATH ?? join(OPENX_DIR, "config.json");
}

/** LLM 渠道池（对齐 mimo2codex providers.json） */
export function getProvidersPath(): string {
  return process.env.OPENX_PROVIDERS_PATH ?? join(getOpenxDir(), "providers.json");
}

/** API Key 等密钥（不入 config.json / providers.json） */
export function getDotEnvPath(): string {
  return process.env.OPENX_DOTENV_PATH ?? join(getOpenxDir(), ".env");
}
/** @deprecated 使用 getConfigPath() */
export const CONFIG_PATH = getConfigPath();
export const INTERNAL_TOKEN_PATH = join(OPENX_DIR, "internal.token");

/** 集中式知识库根目录（全局 + 项目用户知识，不进 git） */
export function getKnowledgeRoot(): string {
  return join(getOpenxDir(), "knowledge");
}

/** Zvec 知识检索索引根目录（可重建，Markdown 仍为源） */
export function getZvecRoot(): string {
  return join(getOpenxDir(), "zvec");
}
