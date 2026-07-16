import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import type { Context, Next } from "hono";
import { getInternalTokenPath } from "./paths.js";

function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const h = host.replace(/^\[|\]$/g, "");
  return h === "127.0.0.1" || h === "::1" || h === "localhost";
}

let cachedToken: string | undefined;

/** 获取或生成 OPENX_HOME/internal.token（Connect /internal 回调使用） */
export function getOrCreateInternalToken(): string {
  if (process.env.OPENX_INTERNAL_TOKEN?.trim()) {
    return process.env.OPENX_INTERNAL_TOKEN.trim();
  }
  if (cachedToken) return cachedToken;

  const tokenPath = getInternalTokenPath();
  if (existsSync(tokenPath)) {
    cachedToken = readFileSync(tokenPath, "utf8").trim();
    if (cachedToken) return cachedToken;
  }

  cachedToken = randomBytes(32).toString("hex");
  mkdirSync(dirname(tokenPath), { recursive: true });
  writeFileSync(tokenPath, cachedToken, { mode: 0o600 });
  return cachedToken;
}

/** 仅允许携带内部令牌访问 /internal/* */
export async function internalOnly(c: Context, next: Next) {
  const envToken = process.env.OPENX_INTERNAL_TOKEN?.trim();
  const token = envToken || getOrCreateInternalToken();
  const headerToken = c.req.header("x-openx-internal-token");

  if (headerToken === token) {
    await next();
    return;
  }

  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    return c.json({ error: "Internal API: token required" }, 403);
  }

  const host = c.req.header("host") ?? "";
  const hostname = host.split(":")[0];
  if (!isLoopbackHost(hostname)) {
    return c.json({ error: "Internal API: token required" }, 403);
  }

  return c.json(
    {
      error:
        "Internal API: missing x-openx-internal-token（见 Connect 注册响应或 OPENX_HOME/internal.token）",
    },
    403,
  );
}
