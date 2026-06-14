#!/usr/bin/env node
/**
 * 配置小米 Mimo Token Plan（新加坡集群）到 OpenX
 * - 工头/PI：OpenAI 兼容 https://token-plan-sgp.xiaomimimo.com/v1
 * - acp:claude：Anthropic 兼容 https://token-plan-sgp.xiaomimimo.com/anthropic
 * - acp:codex：经通用 Codex Responses 代理（node scripts/start-codex-proxy.mjs）
 *
 * 用法:
 *   set MIMO_API_KEY=tp-xxxx
 *   node scripts/setup-mimo-token-plan.mjs
 *
 * 环境变量:
 *   OPENX_BASE   默认 http://127.0.0.1:3921
 *   MIMO_API_KEY 必填（tp- 开头 Token Plan Key，勿提交到 git）
 *   MIMO_MODEL   默认 mimo-v2.5-pro（控制台显示 MiMo-V2.5-Pro）
 *   MIMO_CLUSTER 默认 sgp（sgp | cn | ams）
 */
const BASE = process.env.OPENX_BASE ?? "http://127.0.0.1:3921";
const MIMO_KEY = process.env.MIMO_API_KEY?.trim() ?? "";
const MIMO_MODEL = process.env.MIMO_MODEL?.trim() || "mimo-v2.5-pro";
const CLUSTER = process.env.MIMO_CLUSTER?.trim() || "sgp";

const CLUSTER_HOST = {
  sgp: "token-plan-sgp.xiaomimimo.com",
  cn: "token-plan-cn.xiaomimimo.com",
  ams: "token-plan-ams.xiaomimimo.com",
}[CLUSTER];

if (!CLUSTER_HOST) {
  console.error("MIMO_CLUSTER 须为 sgp | cn | ams");
  process.exit(1);
}
if (!MIMO_KEY) {
  console.error("请设置 MIMO_API_KEY（Token Plan 控制台 → 订阅页）");
  process.exit(1);
}

const OPENAI_BASE = `https://${CLUSTER_HOST}/v1`;
const ANTHROPIC_BASE = `https://${CLUSTER_HOST}/anthropic`;
const OPENAI_SLUG = `mimo-${CLUSTER}`;
const ANTHROPIC_SLUG = `mimo-${CLUSTER}-anthropic`;
const MODEL_REF = `${OPENAI_SLUG}/${MIMO_MODEL}`;
const CLAUDE_MODEL_REF = `${ANTHROPIC_SLUG}/${MIMO_MODEL}`;
const CODEX_PROXY_PORT = process.env.OPENX_CODEX_PROXY_PORT ?? "8788";

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function upsertProvider(slug, config) {
  const { providers } = await api("GET", "/api/model/providers");
  if (providers?.[slug]) {
    await api("PUT", `/api/model/providers/${slug}`, config);
    console.log("[mimo] 已更新渠道:", slug);
  } else {
    await api("POST", "/api/model/providers", { slug, config });
    console.log("[mimo] 已创建渠道:", slug);
  }
}

async function probeOpenAi() {
  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${MIMO_KEY}`,
    },
    body: JSON.stringify({
      model: MIMO_MODEL,
      messages: [{ role: "user", content: "ping" }],
      max_completion_tokens: 8,
    }),
  });
  const text = await res.text();
  console.log("[mimo] OpenAI 探活:", res.ok ? "OK" : `FAIL ${res.status}`, text.slice(0, 80));
  if (!res.ok && res.status !== 429) {
    throw new Error(`OpenAI 探活失败: ${text.slice(0, 200)}`);
  }
}

async function probeAnthropic() {
  const res = await fetch(`${ANTHROPIC_BASE}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": MIMO_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MIMO_MODEL,
      max_tokens: 8,
      messages: [{ role: "user", content: "ping" }],
    }),
  });
  const text = await res.text();
  console.log("[mimo] Anthropic 探活:", res.ok ? "OK" : `FAIL ${res.status}`, text.slice(0, 80));
  if (!res.ok && res.status !== 429) {
    throw new Error(`Anthropic 探活失败: ${text.slice(0, 200)}`);
  }
}

async function main() {
  console.log("[mimo] OpenX →", BASE);
  console.log("[mimo] 集群 →", CLUSTER, "| 模型 →", MIMO_MODEL);

  await api("GET", "/api/health");

  const openaiProvider = {
    name: "小米 Mimo Token Plan",
    api: { type: "openai-compatible", baseUrl: OPENAI_BASE },
    auth: { apiKey: MIMO_KEY, env: "MIMO_API_KEY" },
    models: { [MIMO_MODEL]: { name: MIMO_MODEL } },
    source: { template: "custom" },
  };
  const anthropicProvider = {
    name: "小米 Mimo Token Plan (Anthropic)",
    api: { type: "openai-compatible", baseUrl: ANTHROPIC_BASE },
    auth: { apiKey: MIMO_KEY, env: "MIMO_API_KEY" },
    models: { [MIMO_MODEL]: { name: MIMO_MODEL } },
    source: { template: "anthropic" },
  };
  await upsertProvider(OPENAI_SLUG, openaiProvider);
  await upsertProvider(ANTHROPIC_SLUG, anthropicProvider);

  await probeOpenAi();
  await probeAnthropic();

  await api("PATCH", "/api/settings", {
    model: { coach: MODEL_REF, pi: MODEL_REF, default: MODEL_REF },
  });
  console.log("[mimo] 工头/PI 模型 →", MODEL_REF);

  const claudeAcp = await api("PUT", "/api/cli/acp-config/acp:claude", {
    modelRef: CLAUDE_MODEL_REF,
  });
  console.log("[mimo] acp:claude →", claudeAcp.config.modelRef, "synced=", claudeAcp.config.synced);

  const codexAcp = await api("PUT", "/api/cli/acp-config/acp:codex", {
    modelRef: MODEL_REF,
  });
  console.log("[mimo] acp:codex →", codexAcp.config.modelRef, "synced=", codexAcp.config.synced);
  console.log("[mimo] acp:codex 本地代理 →", codexAcp.config.baseUrl);

  try {
    const proxyHealth = await fetch(`http://127.0.0.1:${CODEX_PROXY_PORT}/health`);
    if (!proxyHealth.ok) throw new Error(`HTTP ${proxyHealth.status}`);
    console.log("[mimo] Codex Responses 代理已就绪:", CODEX_PROXY_PORT);
  } catch {
    console.warn(
      "[mimo] 警告: Codex 代理未运行。请另开终端: node scripts/start-codex-proxy.mjs",
    );
  }

  const coachTest = await api("POST", "/api/model/test", { role: "coach", ref: MODEL_REF });
  console.log("[mimo] 工头连通:", coachTest.ok ? "OK" : coachTest.error);

  console.log("\n[mimo] 配置完成。模型 ID 为 mimo-v2.5-pro（非 mimo-2.5-pro）。");
  console.log("[mimo] Codex 需另开终端: node scripts/start-codex-proxy.mjs");
}

main().catch((e) => {
  console.error("[mimo] 失败:", e.message);
  process.exit(1);
});
