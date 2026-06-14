import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mergeDotEnvContent, parseDotEnv } from "@openx/shared";
import { getDotEnvPath, getOpenxDir } from "./paths.js";

let loaded = false;

/** 启动时加载 ~/.openx/.env（对齐 mimo2codex --load-env） */
export function loadOpenxDotEnv(force = false): string[] {
  if (loaded && !force) return [];
  loaded = true;

  const path = getDotEnvPath();
  if (!existsSync(path)) return [];

  const vars = parseDotEnv(readFileSync(path, "utf8"));
  const applied: string[] = [];
  for (const [key, value] of Object.entries(vars)) {
    process.env[key] = value;
    applied.push(key);
  }
  return applied;
}

/** 合并写入 ~/.openx/.env（供渠道 API 与 setup 脚本使用） */
export function upsertOpenxDotEnv(entries: Record<string, string>): string[] {
  mkdirSync(getOpenxDir(), { recursive: true });
  const path = getDotEnvPath();
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const next = mergeDotEnvContent(existing, entries);
  if (next !== existing) {
    writeFileSync(path, next, "utf8");
  }
  for (const [key, value] of Object.entries(entries)) {
    if (value.trim()) process.env[key] = value;
  }
  return Object.keys(entries).filter((k) => Boolean(entries[k]?.trim()));
}
