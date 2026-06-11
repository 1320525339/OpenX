#!/usr/bin/env node
/**
 * CC (acp:claude) + openx MCP 自举测试
 */
const BASE = process.env.OPENX_BASE ?? "http://127.0.0.1:3921";
const CONV = process.env.OPENX_CONVERSATION_ID ?? "7IDYLMXl49-bhsXu41bRi";
const TIMEOUT_MS = Number(process.env.OPENX_E2E_TIMEOUT_MS ?? 300_000);

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
  const settings = await api("GET", "/api/settings");
  const workspace = process.env.OPENX_WORKSPACE ?? "C:\\Users\\13205\\Desktop\\Demo\\OpenX";
  if (settings.workspaceRoot !== workspace) {
    await api("PUT", "/api/settings", { ...settings, workspaceRoot: workspace });
    console.log("[MCP+CC] 工作区 →", workspace);
  }

  const mcp = await api("GET", "/api/mcp");
  const openx = mcp.servers.find((s) => s.id === "openx");
  if (!openx?.enabled) throw new Error("openx MCP 未启用");
  console.log("[MCP+CC] openx MCP:", openx.args?.[0]);

  const acp = await api("GET", "/api/cli/acp-config/acp:claude");
  if (!acp.config.synced || !acp.config.modelReady) {
    throw new Error("acp:claude 未同步，请先运行 test-acp-claude-auth.mjs");
  }
  console.log("[MCP+CC] Claude:", acp.config.modelRef, acp.config.baseUrl);

  const userDraft = [
    "OpenX 自举验收：CC + openx MCP",
    "",
    "你必须通过 **openx MCP 工具** 完成（不要用 curl/bash）：",
    "1. 调用 openx_get_catalog，记录 meta.endpointCount 与 mcpServerId",
    "2. 调用 openx_call_api：GET /api/executors",
    "3. 调用 openx_call_api：GET /api/goals",
    "",
    "最后用中文汇总三步 JSON 要点。禁止读写项目文件，禁止其他工具。",
  ].join("\n");

  const { goal } = await api("POST", "/api/goals", {
    conversationId: CONV,
    userDraft,
    title: "CC + openx MCP 自举",
    acceptance: "三步 MCP 调用均成功且汇总正确",
    executionPrompt: userDraft,
    executorId: "acp:claude",
    autoStart: true,
    constraints: [
      "仅使用 openx MCP 工具（openx_get_catalog / openx_call_api）",
      "不要 Terminal/bash/文件工具",
    ],
  });

  console.log("\n[MCP+CC] 目标:", goal.id, goal.status);

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { goal: g, logs } = await api("GET", `/api/goals/${goal.id}`);
    const interesting = logs.filter(
      (l) =>
        /openx|mcp|MCP|catalog|executors|工具/i.test(l.message) ||
        l.level === "error",
    );
    const last = interesting[interesting.length - 1] ?? logs[logs.length - 1];
    if (last) console.log(`  [${g.status} ${g.progress}%]`, last.message.slice(0, 140));

    if (["awaiting_review", "done", "failed", "cancelled"].includes(g.status)) {
      console.log("\n[MCP+CC] 最终:", g.status);
      if (g.resultSummary) console.log("摘要:\n", g.resultSummary.slice(0, 800));
      const errs = logs.filter((l) => l.level === "error");
      if (errs.length) errs.slice(-3).forEach((e) => console.log("错误:", e.message.slice(0, 200)));
      const usedMcp = logs.some((l) => /openx_|OpenX API|mcp/i.test(l.message));
      console.log("日志含 MCP 痕迹:", usedMcp);
      process.exit(g.status === "failed" || g.status === "cancelled" ? 1 : 0);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("超时");
}

main().catch((e) => {
  console.error("[MCP+CC] 失败:", e.message);
  process.exit(1);
});
