#!/usr/bin/env node
/**
 * 启动通用 Codex Responses 代理（基于 mimo2codex）
 * - 从 OpenX 导出全部 OpenAI 兼容渠道
 * - Codex CLI 统一连本地代理，按 model 字段路由到各上游
 *
 * 用法: node scripts/start-codex-proxy.mjs
 *
 * 环境变量:
 *   OPENX_BASE              OpenX API（默认 http://127.0.0.1:3921）
 *   OPENX_CODEX_PROXY_PORT  代理端口（默认 8788）
 *   MIMO2CODEX_PROVIDERS_FILE  providers.json 路径
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.OPENX_BASE ?? "http://127.0.0.1:3921";
const PORT = process.env.OPENX_CODEX_PROXY_PORT ?? "8788";
const PROXY_DIR = process.env.OPENX_CODEX_PROXY_DIR ?? join(homedir(), ".openx");
const PROVIDERS_FILE =
  process.env.MIMO2CODEX_PROVIDERS_FILE ??
  join(PROXY_DIR, "codex-proxy-providers.json");

async function loadProxyMeta() {
  const res = await fetch(`${BASE}/api/cli/codex-proxy/providers`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`GET /api/cli/codex-proxy/providers → ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function loadUpstreamEnv() {
  const settings = await fetch(`${BASE}/api/settings`).then((r) => r.json());
  const res = await fetch(`${BASE}/api/cli/codex-proxy/providers`);
  const meta = await res.json();
  const env = { ...process.env };
  for (const slug of new Set(
    (meta.providers ?? []).map((p) => p.id),
  )) {
    const provider = settings.providers?.[slug];
    const envKey = meta.providers?.find((p) => p.id === slug)?.envKey;
    if (!envKey || !provider) continue;
    const key =
      provider.auth?.apiKey?.trim() ||
      (provider.auth?.env ? process.env[provider.auth.env]?.trim() : undefined);
    if (key) env[envKey] = key;
  }
  return env;
}

async function main() {
  const meta = await loadProxyMeta();
  if (!meta.providers?.length) {
    throw new Error("无可用 Codex 代理渠道：请先在 OpenX 配置至少一个 OpenAI 兼容 provider");
  }

  mkdirSync(PROXY_DIR, { recursive: true });
  writeFileSync(
    PROVIDERS_FILE,
    `${JSON.stringify({ providers: meta.providers }, null, 2)}\n`,
    "utf8",
  );

  const env = await loadUpstreamEnv();
  env.MIMO2CODEX_PROVIDERS_FILE = PROVIDERS_FILE;
  env.MIMO2CODEX_PORT = PORT;
  env.OPENX_CODEX_PROXY_PORT = PORT;
  if (meta.defaultProviderId) {
    env.MIMO2CODEX_DEFAULT_PROVIDER = meta.defaultProviderId;
  }

  const modelFlag = meta.defaultProviderId ? ["--model", meta.defaultProviderId] : [];
  console.log("[codex-proxy] 启动 mimo2codex");
  console.log("[codex-proxy] 端口:", PORT, "| 渠道:", meta.providers.length);
  console.log("[codex-proxy] providers:", PROVIDERS_FILE);
  console.log("[codex-proxy] Codex 应指向:", meta.proxyBaseUrl);

  const child = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["--yes", "mimo2codex", "--port", PORT, "--host", "127.0.0.1", ...modelFlag],
    { stdio: "inherit", env, cwd: join(__dirname, ".."), shell: process.platform === "win32" },
  );
  child.on("exit", (code) => process.exit(code ?? 1));
}

main().catch((e) => {
  console.error("[codex-proxy] 失败:", e.message);
  process.exit(1);
});
