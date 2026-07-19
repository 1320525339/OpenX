import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { mergeDotEnvContent, parseDotEnv } from "@openx/shared";
import { getDotEnvPath, getOpenxDir } from "./paths.js";
import { atomicWriteText, SENSITIVE_FILE_MODE } from "./atomic-json.js";

let loaded = false;

type DotEnvCache = {
  path: string;
  mtimeMs: number;
  vars: Record<string, string>;
};

let cache: DotEnvCache | null = null;

/** 使 .env 内存缓存失效（测试 / 外部改写文件后） */
export function invalidateOpenxDotEnvCache(): void {
  cache = null;
  loaded = false;
}

/**
 * 读取 ~/.openx/.env（按 path+mtime 缓存，避免每次 loadSettings 都读盘解析）。
 */
export function readOpenxDotEnvVars(): Record<string, string> {
  const path = getDotEnvPath();
  if (!existsSync(path)) {
    cache = null;
    return {};
  }

  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    cache = null;
    return {};
  }

  if (cache && cache.path === path && cache.mtimeMs === mtimeMs) {
    return cache.vars;
  }

  const vars = parseDotEnv(readFileSync(path, "utf8"));
  cache = { path, mtimeMs, vars };
  return vars;
}

/**
 * 将 ~/.openx/.env 同步进 process.env。
 * OpenX 托管的 .env 是渠道密钥的真相源：文件中出现的键一律覆盖同名环境变量，
 * 避免系统/Shell 里残留的旧 Key 在重启后继续遮蔽设置页已更新的密钥。
 */
export function syncOpenxDotEnv(): string[] {
  const vars = readOpenxDotEnvVars();
  const applied: string[] = [];
  for (const [key, value] of Object.entries(vars)) {
    if (process.env[key] === value) continue;
    process.env[key] = value;
    applied.push(key);
  }
  loaded = true;
  return applied;
}

/**
 * 启动时加载 ~/.openx/.env。
 * @param force 为 true 时重新读取文件并覆盖（热更新）；默认仅首次加载。
 */
export function loadOpenxDotEnv(force = false): string[] {
  if (force) invalidateOpenxDotEnvCache();
  if (loaded && !force) return [];
  return syncOpenxDotEnv();
}

/** 合并写入 ~/.openx/.env（原子写 + 尽量 0o600） */
export function upsertOpenxDotEnv(entries: Record<string, string>): string[] {
  mkdirSync(getOpenxDir(), { recursive: true });
  const path = getDotEnvPath();
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const next = mergeDotEnvContent(existing, entries);
  if (next !== existing) {
    atomicWriteText(path, next.endsWith("\n") ? next : `${next}\n`, {
      mode: SENSITIVE_FILE_MODE,
    });
  }
  invalidateOpenxDotEnvCache();
  for (const [key, value] of Object.entries(entries)) {
    if (value.trim()) process.env[key] = value;
  }
  // 写盘后刷新缓存，后续 sync/get 命中新内容
  void readOpenxDotEnvVars();
  loaded = true;
  return Object.keys(entries).filter((k) => Boolean(entries[k]?.trim()));
}

/** @deprecated 使用 invalidateOpenxDotEnvCache */
export function resetOpenxDotEnvLoadedFlag(): void {
  invalidateOpenxDotEnvCache();
}
