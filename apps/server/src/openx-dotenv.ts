import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { mergeDotEnvContent, parseDotEnv } from "@openx/shared";
import { getDotEnvPath, getOpenxDir } from "./paths.js";
import { atomicWriteText, SENSITIVE_FILE_MODE } from "./atomic-json.js";

let loaded = false;

/**
 * 启动时加载 ~/.openx/.env（对齐 mimo2codex --load-env）。
 * 已存在的 process.env 键不被文件覆盖（环境变量优先）。
 */
export function loadOpenxDotEnv(force = false): string[] {
  if (loaded && !force) return [];
  loaded = true;

  const path = getDotEnvPath();
  if (!existsSync(path)) return [];

  const vars = parseDotEnv(readFileSync(path, "utf8"));
  const applied: string[] = [];
  for (const [key, value] of Object.entries(vars)) {
    if (process.env[key] !== undefined && !force) continue;
    process.env[key] = value;
    applied.push(key);
  }
  return applied;
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
  for (const [key, value] of Object.entries(entries)) {
    if (value.trim()) process.env[key] = value;
  }
  return Object.keys(entries).filter((k) => Boolean(entries[k]?.trim()));
}
