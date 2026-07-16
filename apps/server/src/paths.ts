import { join } from "node:path";
import { DEFAULT_OPENX_DIR, resolveOpenxHome } from "@openx/shared";

/** 默认本机目录；测试/多实例请设 OPENX_HOME（运行时请优先 getOpenxHome） */
export const OPENX_DIR = DEFAULT_OPENX_DIR;

/** 解析数据根目录：OPENX_HOME > OPENX_CONFIG_PATH 父目录 > ~/.openx */
export function getOpenxHome(): string {
  return resolveOpenxHome();
}

export function getOpenxDir(): string {
  return getOpenxHome();
}

/** 测试可设 OPENX_DB_PATH=:memory: */
export function getDbPath(): string {
  return process.env.OPENX_DB_PATH ?? join(getOpenxHome(), "openx.db");
}
/** @deprecated 使用 getDbPath()；模块加载时求值，测试改 env 后可能过期 */
export const DB_PATH = getDbPath();

/** 测试可设 OPENX_CONFIG_PATH 指向隔离 config.json */
export function getConfigPath(): string {
  return process.env.OPENX_CONFIG_PATH ?? join(getOpenxHome(), "config.json");
}

/** LLM 渠道池（对齐 mimo2codex providers.json） */
export function getProvidersPath(): string {
  return process.env.OPENX_PROVIDERS_PATH ?? join(getOpenxHome(), "providers.json");
}

/** API Key 等密钥（不入 config.json / providers.json） */
export function getDotEnvPath(): string {
  return process.env.OPENX_DOTENV_PATH ?? join(getOpenxHome(), ".env");
}
/** @deprecated 使用 getConfigPath() */
export const CONFIG_PATH = getConfigPath();

export function getInternalTokenPath(): string {
  return join(getOpenxHome(), "internal.token");
}
/** @deprecated 使用 getInternalTokenPath()；保留常量名供旧引用，运行时请用 getter */
export const INTERNAL_TOKEN_PATH = join(OPENX_DIR, "internal.token");

export function getMilocoWebhookTokenPath(): string {
  return join(getOpenxHome(), "miloco-webhook.token");
}
/** @deprecated 使用 getMilocoWebhookTokenPath() */
export const MILOCO_WEBHOOK_TOKEN_PATH = join(OPENX_DIR, "miloco-webhook.token");

/** 集中式知识库根目录（全局 + 项目用户知识，不进 git） */
export function getKnowledgeRoot(): string {
  return join(getOpenxHome(), "knowledge");
}

/** Zvec 知识检索索引根目录（可重建，Markdown 仍为源） */
export function getZvecRoot(): string {
  return join(getOpenxHome(), "zvec");
}

/** 备份目录（默认 ~/.openx/backups） */
export function getBackupsRoot(): string {
  return join(getOpenxHome(), "backups");
}

/** Miloco 记忆目录 */
export function getMilocoMemoryDir(): string {
  return join(getOpenxHome(), "miloco-memory");
}

export function getMilocoConfigPath(): string {
  return join(getOpenxHome(), "miloco-config.json");
}

export function getMilocoPresenceConfigPath(): string {
  return join(getOpenxHome(), "miloco-presence.json");
}

export function getMilocoPresenceStatePath(): string {
  return join(getOpenxHome(), "miloco-device-presence-state.json");
}

export function getMilocoLayerBCachePath(): string {
  return join(getOpenxHome(), "miloco-layer-b-cache.json");
}

export function getMilocoCronStatePath(): string {
  return join(getOpenxHome(), "miloco-cron-state.json");
}

export function getMilocoHabitSuggestPath(): string {
  return join(getOpenxHome(), "miloco-habit-suggest.json");
}
