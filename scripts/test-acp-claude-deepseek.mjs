#!/usr/bin/env node
/**
 * DeepSeek Anthropic 端点 + acp:claude 派单通讯测试
 * 前置: node scripts/setup-deepseek.mjs（DEEPSEEK_API_KEY 已配置）
 *
 * 用法:
 *   set DEEPSEEK_API_KEY=sk-xxxx
 *   node scripts/setup-deepseek.mjs
 *   node scripts/test-acp-claude-deepseek.mjs
 */
const BASE = process.env.OPENX_BASE ?? "http://127.0.0.1:3921";
const MODEL = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash";
const MODEL_REF = `deepseek/${MODEL}`;

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
  console.log("[deepseek/claude] OpenX →", BASE);
  console.log("[deepseek/claude] modelRef →", MODEL_REF);

  await api("GET", "/api/health");

  const acpCfg = await api("PUT", "/api/cli/acp-config/acp:claude", {
    modelRef: MODEL_REF,
  });
  console.log("[deepseek/claude] Claude CLI:", {
    synced: acpCfg.config?.synced,
    baseUrl: acpCfg.config?.baseUrl,
    modelRef: acpCfg.config?.modelRef,
  });
  if (!acpCfg.config?.synced) {
    throw new Error("请先运行 node scripts/setup-deepseek.mjs 配置 DeepSeek 渠道");
  }

  const { executors } = await api("GET", "/api/executors");
  const claude = executors.find((e) => e.id === "acp:claude");
  console.log("[deepseek/claude] acp:claude available:", claude?.available, claude?.hint ?? "");

  const workspace = process.env.OPENX_WORKSPACE ?? process.cwd();
  let { projects, conversations } = await api("GET", "/api/projects");
  let project = projects.find((p) => p.workspaceDir === workspace) ?? projects[0];
  if (!project) {
    project = (await api("POST", "/api/projects", { name: "OpenX", workspaceDir: workspace }))
      .project;
  }
  let conv =
    conversations.find((c) => c.projectId === project.id && c.title?.includes("DeepSeek")) ??
    conversations.find((c) => c.projectId === project.id);
  if (!conv) {
    conv = (
      await api("POST", `/api/projects/${project.id}/conversations`, {
        title: "DeepSeek Claude ACP",
      })
    ).conversation;
  }

  const { goal } = await api("POST", "/api/goals", {
    conversationId: conv.id,
    userDraft: "DeepSeek Claude ACP 鉴权通讯测试",
    title: "DeepSeek-Claude-ACP-Ping",
    acceptance: "返回一句中文确认已连通",
    executionPrompt:
      "请用一句中文回复：「DeepSeek Claude ACP 鉴权通讯正常」。不要调用任何工具，不要读写文件。",
    executorId: "acp:claude",
    autoStart: true,
  });

  console.log("\n[deepseek/claude] 目标已派单:", goal.id, goal.status);

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const detail = await api("GET", `/api/goals/${goal.id}`);
    const { goal: g, logs } = detail;
    const last = logs[logs.length - 1];
    if (last) console.log(`  [${g.status} ${g.progress}%]`, last.message.slice(0, 120));
    if (["awaiting_review", "done", "failed", "cancelled"].includes(g.status)) {
      console.log("\n[deepseek/claude] 最终结果:", g.status);
      if (g.resultSummary) console.log("摘要:", g.resultSummary.slice(0, 400));
      const err = logs.find((l) => l.level === "error");
      if (err) console.log("错误:", err.message.slice(0, 400));
      process.exit(g.status === "failed" || g.status === "cancelled" ? 1 : 0);
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error("派单超时");
}

main().catch((e) => {
  console.error("[deepseek/claude] 失败:", e.message);
  process.exit(1);
});
