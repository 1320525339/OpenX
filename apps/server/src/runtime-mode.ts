import { isIP } from "node:net";

/** 本机桌面默认模式：强制 loopback，无 Origin 客户端可访问 */
export type OpenxRuntimeMode = "desktop-local" | "remote";

export type RuntimeBindConfig = {
  mode: OpenxRuntimeMode;
  host: string;
  port: number;
  /** remote 模式要求配置的 API token（Bearer / x-openx-api-token） */
  apiToken: string | undefined;
};

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (LOOPBACK_HOSTS.has(h)) return true;
  // IPv4 mapped IPv6
  if (h === "::ffff:127.0.0.1") return true;
  const ipVersion = isIP(h);
  if (ipVersion === 4) return h === "127.0.0.1";
  if (ipVersion === 6) return h === "::1";
  return false;
}

/**
 * OPENX_RUNTIME_MODE=remote|desktop-local
 * 未设置时：HOST 为 loopback → desktop-local，否则 remote。
 */
export function resolveRuntimeMode(
  env: NodeJS.ProcessEnv = process.env,
): OpenxRuntimeMode {
  const raw = env.OPENX_RUNTIME_MODE?.trim().toLowerCase();
  if (raw === "remote") return "remote";
  if (raw === "desktop-local" || raw === "local" || raw === "desktop") {
    return "desktop-local";
  }
  const host = env.HOST?.trim() || "127.0.0.1";
  return isLoopbackHost(host) ? "desktop-local" : "remote";
}

export function resolveRuntimeBindConfig(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeBindConfig {
  const mode = resolveRuntimeMode(env);
  const port = Number(env.PORT ?? 3921);
  const host = env.HOST?.trim() || "127.0.0.1";
  const apiToken =
    env.OPENX_API_TOKEN?.trim() || env.OPENX_REMOTE_API_TOKEN?.trim() || undefined;
  return { mode, host, port, apiToken };
}

export type RuntimeBindValidation =
  | { ok: true; config: RuntimeBindConfig }
  | { ok: false; error: string; config: RuntimeBindConfig };

/** 启动前校验：desktop-local 必须 loopback；remote 必须有 API token */
export function validateRuntimeBind(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeBindValidation {
  const config = resolveRuntimeBindConfig(env);
  if (config.mode === "desktop-local") {
    if (!isLoopbackHost(config.host)) {
      return {
        ok: false,
        config,
        error:
          `desktop-local 模式禁止绑定非本机地址（当前 HOST=${config.host}）。` +
          `请使用 127.0.0.1 / ::1，或改 OPENX_RUNTIME_MODE=remote 并配置 OPENX_API_TOKEN。`,
      };
    }
    return { ok: true, config };
  }
  if (!config.apiToken) {
    return {
      ok: false,
      config,
      error:
        "remote 模式启动前必须配置 OPENX_API_TOKEN（或 OPENX_REMOTE_API_TOKEN）。" +
        "生产环境还应在反向代理终止 TLS。",
    };
  }
  return { ok: true, config };
}

export function extractApiTokenFromRequest(headers: {
  get(name: string): string | undefined;
}): string | undefined {
  const bearer = headers.get("authorization");
  if (bearer?.toLowerCase().startsWith("bearer ")) {
    const token = bearer.slice(7).trim();
    if (token) return token;
  }
  const headerToken = headers.get("x-openx-api-token")?.trim();
  return headerToken || undefined;
}
