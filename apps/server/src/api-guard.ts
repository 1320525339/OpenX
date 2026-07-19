import type { Context, Next } from "hono";
import {
  extractApiTokenFromRequest,
  resolveRuntimeMode,
} from "./runtime-mode.js";
import { getOrCreateApiToken } from "./api-token.js";

const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://tauri.localhost",
  "https://tauri.localhost",
]);

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function originAllowed(origin: string): boolean {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (origin.endsWith(".tauri.localhost")) return true;
  if (origin === "null" || origin === "file://") return true;
  return false;
}

function refererAllowed(referer: string): boolean {
  try {
    const url = new URL(referer);
    return originAllowed(url.origin);
  } catch {
    return false;
  }
}

/**
 * remote 模式：/api/*（health 除外）必须携带 OPENX_API_TOKEN。
 * desktop-local：浏览器（合法 Origin）走 CSRF；无 Origin 的非浏览器客户端须带 api.token。
 */
export async function apiAccessGuard(c: Context, next: Next) {
  const mode = resolveRuntimeMode();
  const path = new URL(c.req.url).pathname;
  if (path === "/api/health") {
    await next();
    return;
  }

  if (mode === "remote") {
    const expected =
      process.env.OPENX_API_TOKEN?.trim() ||
      process.env.OPENX_REMOTE_API_TOKEN?.trim();
    const provided = extractApiTokenFromRequest({
      get: (name) => c.req.header(name),
    });
    if (!expected || !provided || provided !== expected) {
      return c.json({ error: "Unauthorized: remote 模式需要 API token" }, 401);
    }
  } else {
    // desktop-local：默认仅生成 api.token；设 OPENX_ENFORCE_DESKTOP_API_TOKEN=1 后，
    // 无 Origin 的写请求须带 token（浏览器合法 Origin 仍走 CSRF，不破坏 Web UI）。
    const enforce =
      process.env.OPENX_ENFORCE_DESKTOP_API_TOKEN === "1" ||
      process.env.OPENX_ENFORCE_DESKTOP_API_TOKEN === "true";
    const origin = c.req.header("origin");
    if (
      enforce &&
      !origin &&
      STATE_CHANGING.has(c.req.method) &&
      !path.startsWith("/internal/")
    ) {
      const expected = getOrCreateApiToken();
      const provided = extractApiTokenFromRequest({
        get: (name) => c.req.header(name),
      });
      if (!provided || provided !== expected) {
        return c.json(
          {
            error:
              "Unauthorized: desktop-local 非浏览器请求需要 API token（见 ~/.openx/api.token 或 OPENX_API_TOKEN）",
          },
          401,
        );
      }
    }
  }
  await browserCsrfGuard(c, next);
}

/**
 * 阻止跨站简单请求对本地 API 的 CSRF 副作用。
 * 浏览器请求须带允许的 Origin/Referer；无 Origin 的非浏览器客户端（Connect CLI 等）放行。
 */
export async function browserCsrfGuard(c: Context, next: Next) {
  if (!STATE_CHANGING.has(c.req.method)) {
    await next();
    return;
  }

  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/internal/")) {
    await next();
    return;
  }

  const origin = c.req.header("origin");
  const referer = c.req.header("referer");

  if (origin) {
    if (!originAllowed(origin)) {
      return c.json({ error: "Forbidden: invalid origin" }, 403);
    }
    await next();
    return;
  }

  if (referer) {
    if (!refererAllowed(referer)) {
      return c.json({ error: "Forbidden: invalid referer" }, 403);
    }
    await next();
    return;
  }

  await next();
}
