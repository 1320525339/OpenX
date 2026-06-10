import type { Context, Next } from "hono";

const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function originAllowed(origin: string): boolean {
  return ALLOWED_ORIGINS.has(origin);
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

  // 无 Origin/Referer：Connect CLI、curl、本机脚本等非浏览器客户端
  await next();
}
