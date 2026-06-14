#!/usr/bin/env node
/**
 * 工头（DeepSeek）自举功能点检测
 *
 * 前置: node scripts/setup-deepseek.mjs（或已配置 coach → deepseek/*）
 *
 * 用法:
 *   node scripts/coach-deepseek-bootstrap.mjs
 *
 * 环境变量: OPENX_BASE, OPENX_E2E_TIMEOUT_MS（默认 120000）
 */
const BASE = process.env.OPENX_BASE ?? "http://127.0.0.1:3921";
const TIMEOUT_MS = Number(process.env.OPENX_E2E_TIMEOUT_MS ?? 120_000);
const WORKSPACE = process.env.OPENX_WORKSPACE ?? process.cwd();

const steps = [];

function step(id, ok, detail) {
  steps.push({ id, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${id}: ${detail}`);
}

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
    err.data = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

async function ensureConversation() {
  const { projects, conversations } = await api("GET", "/api/projects");
  let project = projects.find((p) => p.workspaceDir === WORKSPACE);
  if (!project) {
    const created = await api("POST", "/api/projects", {
      name: "OpenX",
      workspaceDir: WORKSPACE,
    });
    project = created.project;
  }
  let conversation = conversations.find((c) => c.projectId === project.id);
  if (!conversation) {
    const created = await api("POST", `/api/projects/${project.id}/conversations`, {
      title: "工头自举",
    });
    conversation = created.conversation;
  }
  return conversation.id;
}

async function fetchWithRetry(url, init, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(url, { ...init, signal: controller.signal });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`${res.status}: ${data.error ?? res.statusText}`);
        return data;
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      lastErr = err;
      if (i < retries - 1) await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw lastErr;
}

async function coachChat(conversationId, message, opts = {}) {
  return fetchWithRetry(`${BASE}/api/coach/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversationId,
      message,
      skipRefine: opts.skipRefine ?? true,
      forceRefine: opts.forceRefine ?? false,
    }),
  });
}

async function main() {
  console.log(`\n=== 工头 DeepSeek 自举检测 → ${BASE} ===\n`);

  const health = await api("GET", "/api/health");
  step("health", health.ok === true, "服务在线");

  const coachStatus = await api("GET", "/api/coach/status");
  step(
    "coach_ready",
    coachStatus.ready === true,
    `model=${coachStatus.model ?? "?"} base=${coachStatus.baseUrl ?? "?"}`,
  );
  if (!coachStatus.ready) {
    throw new Error("工头未就绪，请先 node scripts/setup-deepseek.mjs");
  }

  const coachTest = await api("POST", "/api/coach/test");
  step("coach_test", coachTest.ok === true, coachTest.reply?.slice(0, 60) ?? coachTest.error ?? "");

  const catalog = await api("GET", "/api/catalog");
  step(
    "api_catalog",
    catalog.meta?.endpointCount > 0,
    `endpoints=${catalog.meta?.endpointCount}`,
  );

  const settings = await api("GET", "/api/settings");
  const tier = settings.operatorTier ?? "off";
  step("operator_tier", tier === "operator" || tier === "admin", `tier=${tier}`);

  if (tier === "operator" || tier === "admin") {
    try {
      const selfTest = await api("POST", "/api/operator/self-test", { skipConnect: true });
      step(
        "operator_self_test",
        selfTest.ok === true,
        `${selfTest.steps?.filter((s) => s.ok).length ?? 0}/${selfTest.steps?.length ?? 0} 步通过`,
      );
      if (!selfTest.ok) {
        for (const s of selfTest.steps ?? []) {
          if (!s.ok) console.log(`    - ${s.id}: ${s.detail}`);
        }
      }
    } catch (e) {
      step("operator_self_test", false, e.message);
    }
  } else {
    step("operator_self_test", false, "需要 operator/admin，setup-deepseek 会自动提升");
  }

  const conversationId = await ensureConversation();
  step("conversation", Boolean(conversationId), conversationId);

  console.log("\n--- 工头对话：基础回复 ---");
  const chat1 = await coachChat(
    conversationId,
    "用一句话说明 OpenX 工头助手的职责",
  );
  const msg1 = chat1.message ?? "";
  step(
    "coach_chat",
    msg1.length > 10,
    msg1.slice(0, 100).replace(/\s+/g, " "),
  );

  console.log("\n--- 工头 refine：任务单整理 ---");
  const refined = await api("POST", "/api/coach/refine", {
    userDraft: "调用 GET /api/health 确认 ok 为 true",
    title: "健康检查",
    acceptance: "health 返回 ok:true",
  });
  const hasPrompt = Boolean(refined.executionPrompt);
  const usedFallback = Boolean(refined.meta?.llmError);
  step(
    "coach_refine",
    hasPrompt,
    `${refined.title ?? "?"}${usedFallback ? "（规则引擎兜底）" : ""}`,
  );

  const passed = steps.filter((s) => s.ok).length;
  const failed = steps.filter((s) => !s.ok).length;
  console.log(`\n=== 结果: ${passed} 通过, ${failed} 失败 ===\n`);

  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("\n工头自举检测失败:", e.message);
  process.exit(1);
});
