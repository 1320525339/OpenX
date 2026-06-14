#!/usr/bin/env node
/**
 * 配置 DeepSeek 为 OpenX 工头/PI 模型（OpenAI 兼容）
 * 文档: https://api-docs.deepseek.com/zh-cn/
 *
 * 用法:
 *   set DEEPSEEK_API_KEY=sk-xxxx
 *   node scripts/setup-deepseek.mjs
 *
 * 环境变量:
 *   OPENX_BASE        默认 http://127.0.0.1:3921
 *   DEEPSEEK_API_KEY  必填（勿提交 git）
 *   DEEPSEEK_MODEL    默认 deepseek-v4-flash（deepseek-chat 将于 2026/07 弃用）
 */
const BASE = process.env.OPENX_BASE ?? "http://127.0.0.1:3921";
const API_KEY = process.env.DEEPSEEK_API_KEY?.trim() ?? "";
const MODEL = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash";
const BASE_URL = "https://api.deepseek.com/v1";
const SLUG = "deepseek";
const MODEL_REF = `${SLUG}/${MODEL}`;

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
    console.log("[deepseek] 已更新渠道:", slug);
  } else {
    await api("POST", "/api/model/providers", { slug, config });
    console.log("[deepseek] 已创建渠道:", slug);
  }
}

async function probe() {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 8,
    }),
  });
  const text = await res.text();
  console.log("[deepseek] 上游探活:", res.ok ? "OK" : `FAIL ${res.status}`, text.slice(0, 80));
  if (!res.ok) throw new Error(`探活失败: ${text.slice(0, 200)}`);
}

async function main() {
  if (!API_KEY) {
    console.error("请设置 DEEPSEEK_API_KEY");
    process.exit(1);
  }

  console.log("[deepseek] OpenX →", BASE);
  console.log("[deepseek] 模型 →", MODEL);

  await api("GET", "/api/health");

  await upsertProvider(SLUG, {
    name: "DeepSeek",
    api: { type: "openai-compatible", baseUrl: BASE_URL },
    auth: { apiKey: API_KEY, env: "DEEPSEEK_API_KEY" },
    models: {
      [MODEL]: { name: MODEL },
      "deepseek-chat": { name: "deepseek-chat (→ v4-flash)" },
      "deepseek-reasoner": { name: "deepseek-reasoner (→ v4-pro 思考)" },
      "deepseek-v4-pro": { name: "deepseek-v4-pro" },
    },
    source: { template: "deepseek" },
  });

  await probe();

  const { operatorTier } = await api("GET", "/api/settings");
  const tier = operatorTier === "off" ? "operator" : operatorTier;
  await api("PATCH", "/api/settings", {
    model: { coach: MODEL_REF, pi: MODEL_REF, default: MODEL_REF },
    operatorTier: tier,
  });
  console.log("[deepseek] 工头/PI 模型 →", MODEL_REF);
  console.log("[deepseek] operatorTier →", tier);

  const coachTest = await api("POST", "/api/coach/test");
  console.log("[deepseek] 工头连通:", coachTest.ok ? "OK" : coachTest.error);

  const modelTest = await api("POST", "/api/model/test", { role: "coach", ref: MODEL_REF });
  console.log("[deepseek] 模型测试:", modelTest.ok ? "OK" : modelTest.error);

  const anthropicBase = "https://api.deepseek.com/anthropic";
  const anthropicProbe = await fetch(`${anthropicBase}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
      Authorization: `Bearer ${API_KEY}`,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16,
      messages: [{ role: "user", content: "ping" }],
    }),
  });
  const anthropicBody = await anthropicProbe.text();
  console.log(
    "[deepseek] Anthropic 探活:",
    anthropicProbe.ok ? "OK" : `FAIL ${anthropicProbe.status}`,
    anthropicBody.slice(0, 100),
  );
  if (!anthropicProbe.ok && anthropicProbe.status !== 429) {
    throw new Error(`Anthropic 探活失败: ${anthropicBody.slice(0, 200)}`);
  }

  const acpCfg = await api("PUT", "/api/cli/acp-config/acp:claude", {
    modelRef: MODEL_REF,
  });
  console.log("[deepseek] acp:claude 同步:", {
    modelRef: acpCfg.config?.modelRef,
    synced: acpCfg.config?.synced,
    baseUrl: acpCfg.config?.baseUrl,
    apiKeyPreview: acpCfg.config?.apiKeyPreview,
  });
  if (!acpCfg.config?.synced) {
    throw new Error("acp:claude 未同步到 ~/.claude/settings.json");
  }

  console.log("\n[deepseek] 配置完成。Claude CLI 测试: node scripts/test-acp-claude-deepseek.mjs");
  console.log("[deepseek] 工头自举: node scripts/coach-deepseek-bootstrap.mjs");
}

main().catch((e) => {
  console.error("[deepseek] 失败:", e.message);
  process.exit(1);
});
