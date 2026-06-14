#!/usr/bin/env node
/**
 * 将 OpenX 全部 OpenAI 兼容渠道导出到 Codex Responses 代理配置（mimo2codex providers.json）
 *
 * 用法: node scripts/sync-codex-proxy.mjs
 * 环境变量: OPENX_BASE（默认 http://127.0.0.1:3921）
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = process.env.OPENX_BASE ?? "http://127.0.0.1:3921";
const OUT_DIR = process.env.OPENX_CODEX_PROXY_DIR ?? join(homedir(), ".openx");
const OUT_FILE =
  process.env.MIMO2CODEX_PROVIDERS_FILE ?? join(OUT_DIR, "codex-proxy-providers.json");

async function main() {
  const res = await fetch(`${BASE}/api/cli/codex-proxy/providers`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`GET /api/cli/codex-proxy/providers → ${res.status}: ${JSON.stringify(data)}`);
  }
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, `${JSON.stringify({ providers: data.providers }, null, 2)}\n`, "utf8");
  console.log("[codex-proxy] 已导出", data.providers?.length ?? 0, "个渠道 →", OUT_FILE);
  console.log("[codex-proxy] 代理地址:", data.proxyBaseUrl);
  if (data.defaultProviderId) {
    console.log("[codex-proxy] acp:codex 绑定:", `${data.defaultProviderId}/${data.defaultModel}`);
  }
  console.log("[codex-proxy] 需注入 env:", data.envKeys?.join(", ") || "(无)");
}

main().catch((e) => {
  console.error("[codex-proxy] 失败:", e.message);
  process.exit(1);
});
