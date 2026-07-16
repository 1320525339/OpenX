import { existsSync, readFileSync } from "node:fs";
import { getInternalTokenPath } from "./paths.js";

export type OpenxApiCallInput = {
  baseUrl: string;
  method: string;
  path: string;
  body?: unknown;
  query?: Record<string, string>;
  internalToken?: string;
};

export type OpenxApiCallResult = {
  ok: boolean;
  status: number;
  path: string;
  method: string;
  data?: unknown;
  error?: string;
  transport?: "http" | "sse";
};

const ALLOWED_PREFIXES = ["/api/", "/internal/"];

let inProcessHandler:
  | ((input: OpenxApiCallInput) => Promise<OpenxApiCallResult>)
  | undefined;

/** 测试/自举：走 Hono app.request 而非 fetch */
export function setInProcessApiHandler(
  handler: ((input: OpenxApiCallInput) => Promise<OpenxApiCallResult>) | undefined,
): void {
  inProcessHandler = handler;
}

export function normalizeApiPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.startsWith("/")) return `/${trimmed}`;
  return trimmed;
}

export function isAllowedApiPath(path: string): boolean {
  return ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function resolveInternalToken(explicit?: string): string | undefined {
  if (explicit?.trim()) return explicit.trim();
  if (process.env.OPENX_INTERNAL_TOKEN?.trim()) {
    return process.env.OPENX_INTERNAL_TOKEN.trim();
  }
  const tokenPath = getInternalTokenPath();
  if (existsSync(tokenPath)) {
    const token = readFileSync(tokenPath, "utf8").trim();
    if (token) return token;
  }
  return undefined;
}

export function substitutePathParams(
  path: string,
  pathParams?: Record<string, string>,
): string {
  if (!pathParams) return path;
  let out = path;
  for (const [key, value] of Object.entries(pathParams)) {
    out = out.replace(`:${key}`, encodeURIComponent(value));
    out = out.replace(`{${key}}`, encodeURIComponent(value));
  }
  return out;
}

export async function callOpenxApi(input: OpenxApiCallInput): Promise<OpenxApiCallResult> {
  if (inProcessHandler) {
    return inProcessHandler(input);
  }

  const method = input.method.toUpperCase();
  let path = normalizeApiPath(input.path);

  if (!isAllowedApiPath(path)) {
    return {
      ok: false,
      status: 400,
      path,
      method,
      error: "path 必须以 /api/ 或 /internal/ 开头",
    };
  }

  if (path === "/api/events" || path.startsWith("/api/events?")) {
    return {
      ok: false,
      status: 400,
      path,
      method,
      transport: "sse",
      error: "/api/events 为 SSE 长连接，不可经 openx_call_api 调用",
    };
  }

  const base = input.baseUrl.replace(/\/$/, "");
  const url = new URL(`${base}${path}`);
  if (input.query) {
    for (const [key, value] of Object.entries(input.query)) {
      if (value !== undefined && value !== "") {
        url.searchParams.set(key, value);
      }
    }
  }

  const headers: Record<string, string> = { Accept: "application/json" };

  const needsInternal = path.startsWith("/internal/");
  const internalToken = needsInternal ? resolveInternalToken(input.internalToken) : undefined;
  if (needsInternal) {
    if (!internalToken) {
      return {
        ok: false,
        status: 401,
        path,
        method,
        error: "缺少 internal token",
      };
    }
    headers["x-openx-internal-token"] = internalToken;
  }

  let body: string | undefined;
  if (input.body !== undefined && method !== "GET" && method !== "HEAD") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(input.body);
  }

  try {
    const res = await fetch(url.toString(), { method, headers, body });
    const text = await res.text();
    let data: unknown = text;
    if (text) {
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        data = text;
      }
    } else {
      data = null;
    }

    return {
      ok: res.ok,
      status: res.status,
      path: url.pathname + url.search,
      method,
      data,
      error: res.ok
        ? undefined
        : typeof data === "object" && data && "error" in data
          ? String((data as { error: unknown }).error)
          : res.statusText,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      path,
      method,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
