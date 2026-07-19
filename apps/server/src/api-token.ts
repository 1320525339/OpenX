/**
 * desktop-local API token：写入 ~/.openx/api.token。
 * 无 Origin 的非浏览器请求必须携带，防止同机任意进程乱调 API。
 * 浏览器请求（合法 Origin）仍走 CSRF，无需带 token（避免破坏现有 Web UI）。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { getOpenxHome } from "./paths.js";

let cached: string | undefined;

export function getApiTokenPath(): string {
  return process.env.OPENX_API_TOKEN_PATH?.trim() || join(getOpenxHome(), "api.token");
}

export function getOrCreateApiToken(): string {
  const envToken =
    process.env.OPENX_API_TOKEN?.trim() ||
    process.env.OPENX_REMOTE_API_TOKEN?.trim() ||
    process.env.OPENX_DESKTOP_API_TOKEN?.trim();
  if (envToken) return envToken;
  if (cached) return cached;

  const tokenPath = getApiTokenPath();
  if (existsSync(tokenPath)) {
    cached = readFileSync(tokenPath, "utf8").trim();
    if (cached) return cached;
  }

  cached = randomBytes(32).toString("hex");
  mkdirSync(dirname(tokenPath), { recursive: true });
  writeFileSync(tokenPath, cached, { mode: 0o600 });
  return cached;
}
