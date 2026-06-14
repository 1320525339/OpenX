#!/usr/bin/env node
/**
 * 配置 acp:claude (CC) 自定义 Anthropic 代理并派单通讯测试
 * 用法: node scripts/test-acp-claude-auth.mjs
 * 环境变量可覆盖: OPENX_BASE, MIMO_BASE_URL, MIMO_API_KEY, MIMO_MODEL
 */
const BASE = process.env.OPENX_BASE ?? "http://127.0.0.1:3921";
const MIMO_BASE =
  process.env.MIMO_BASE_URL ?? "https://token-plan-sgp.xiaomimimo.com/anthropic";
const MIMO_KEY = process.env.MIMO_API_KEY ?? "";
const MIMO_MODEL = process.env.MIMO_MODEL ?? "mimo-v2.5-pro";
const CLUSTER = process.env.MIMO_CLUSTER?.trim() || "sgp";
const PROVIDER_SLUG = process.env.MIMO_PROVIDER_SLUG ?? `mimo-${CLUSTER}-anthropic`;
const MODEL_REF = `${PROVIDER_SLUG}/${MIMO_MODEL}`;

if (!MIMO_KEY) {
  console.error("请设置 MIMO_API_KEY 环境变量");
  process.exit(1);
}

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

async function main() {
  console.log("[CC/ACP] base:", BASE);
  console.log("[CC/ACP] anthropic baseUrl:", MIMO_BASE);
  console.log("[CC/ACP] model:", MIMO_MODEL);

  const providerConfig = {
    name: "小米 Mimo Anthropic 代理",
    api: { type: "openai-compatible", baseUrl: MIMO_BASE },
    auth: { apiKey: MIMO_KEY },
    models: {
      [MIMO_MODEL]: { name: MIMO_MODEL },
    },
    source: { template: "anthropic" },
  };

  const settings = await api("GET", "/api/settings");
  const existing = settings.providers?.[PROVIDER_SLUG];
  if (existing) {
    await api("PUT", `/api/model/providers/${PROVIDER_SLUG}`, providerConfig);
    console.log("[CC/ACP] 已更新渠道:", PROVIDER_SLUG);
  } else {
    await api("POST", "/api/model/providers", { slug: PROVIDER_SLUG, config: providerConfig });
    console.log("[CC/ACP] 已创建渠道:", PROVIDER_SLUG);
  }

  // MiMo Anthropic 代理非 OpenAI chat/completions，直连探活
  const probe = await fetch(`${MIMO_BASE.replace(/\/$/, "")}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": MIMO_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MIMO_MODEL,
      max_tokens: 16,
      messages: [{ role: "user", content: "ping" }],
    }),
  });
  const probeBody = await probe.text();
  console.log(
    "[CC/ACP] Anthropic 探活:",
    probe.ok ? "OK" : `FAIL ${probe.status}`,
    probeBody.slice(0, 80),
  );
  if (!probe.ok && probe.status !== 429) {
    throw new Error(`Anthropic 探活失败: ${probeBody.slice(0, 200)}`);
  }
  if (!probe.ok) console.log("[CC/ACP] Anthropic 探活限流，跳过直连探活继续配置");

  const acpCfg = await api("PUT", "/api/cli/acp-config/acp:claude", {
    modelRef: MODEL_REF,
  });
  console.log("[CC/ACP] Claude CLI 同步:", {
    modelRef: acpCfg.config.modelRef,
    synced: acpCfg.config.synced,
    modelReady: acpCfg.config.modelReady,
    baseUrl: acpCfg.config.baseUrl,
    apiKeyPreview: acpCfg.config.apiKeyPreview,
  });

  if (!acpCfg.config.synced) {
    throw new Error("ACP CLI 配置未同步到本机 ~/.claude/settings.json");
  }

  const workspace = process.env.OPENX_WORKSPACE ?? process.cwd();
  let { projects, conversations } = await api("GET", "/api/projects");
  let project = projects.find((p) => p.workspaceDir === workspace) ?? projects[0];
  if (!project) {
    const created = await api("POST", "/api/projects", {
      name: "OpenX",
      workspaceDir: workspace,
    });
    project = created.project;
    console.log("[CC/ACP] 创建项目:", project.id);
  }
  let conv =
    conversations.find((c) => c.projectId === project.id && c.title?.includes("ACP")) ??
    conversations.find((c) => c.projectId === project.id);
  if (!conv) {
    const created = await api("POST", `/api/projects/${project.id}/conversations`, {
      title: "CC ACP 测试",
    });
    conv = created.conversation;
    console.log("[CC/ACP] 创建对话:", conv.id);
  }
  if (!conv) throw new Error("无可用对话");

  const { goal } = await api("POST", "/api/goals", {
    conversationId: conv.id,
    userDraft: "CC ACP 鉴权通讯测试",
    title: "CC ACP 鉴权通讯测试",
    acceptance: "返回一句中文确认已连通",
    executionPrompt:
      "请用一句中文回复：「CC ACP 鉴权通讯正常」。不要调用任何工具，不要读写文件。",
    executorId: "acp:claude",
    autoStart: true,
  });

  console.log("\n[CC/ACP] 目标已派单:", goal.id, goal.status);

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const detail = await api("GET", `/api/goals/${goal.id}`);
    const { goal: g, logs } = detail;
    const last = logs[logs.length - 1];
    if (last) console.log(`  [${g.status} ${g.progress}%]`, last.message.slice(0, 100));
    if (["awaiting_review", "done", "failed", "cancelled"].includes(g.status)) {
      console.log("\n[CC/ACP] 最终结果:", g.status);
      if (g.resultSummary) console.log("摘要:", g.resultSummary.slice(0, 300));
      const err = logs.find((l) => l.level === "error");
      if (err) console.log("错误:", err.message.slice(0, 300));
      process.exit(g.status === "failed" || g.status === "cancelled" ? 1 : 0);
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error("派单超时");
}

main().catch((e) => {
  console.error("[CC/ACP] 失败:", e.message);
  process.exit(1);
});
