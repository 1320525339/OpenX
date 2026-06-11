#!/usr/bin/env node
/**
 * OpenX 项目自举启动脚本
 * 1. 工作区指向 OpenX 仓库根目录
 * 2. 确保 openx MCP 已注册
 * 3. 创建并启动「自举验收」目标
 */
const BASE = process.env.OPENX_BASE ?? "http://127.0.0.1:3921";
const WORKSPACE = process.env.OPENX_WORKSPACE ?? "C:\\Users\\13205\\Desktop\\Demo\\OpenX";

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function main() {
  console.log(`[自举] OpenX API → ${BASE}`);
  console.log(`[自举] 工作区 → ${WORKSPACE}`);

  const health = await api("GET", "/api/health");
  console.log("[自举] 健康检查:", health);

  const catalog = await api("GET", "/api/catalog");
  console.log(`[自举] API 目录: ${catalog.meta.endpointCount} 个端点, MCP id=${catalog.meta.mcpServerId}`);

  const mcp = await api("GET", "/api/mcp");
  const openxMcp = mcp.servers.find((s) => s.id === "openx");
  if (!openxMcp?.enabled) {
    throw new Error("openx MCP 未启用，请先 pnpm --filter @openx/mcp-openx build 并重启 server");
  }
  console.log("[自举] openx MCP 已就绪:", openxMcp.args?.[0]);

  const settings = await api("GET", "/api/settings");
  if (settings.workspaceRoot !== WORKSPACE) {
    const next = await api("PUT", "/api/settings", {
      ...settings,
      workspaceRoot: WORKSPACE,
    });
    console.log("[自举] 工作区已更新:", next.workspaceRoot);
  }

  let project;
  let conversation;
  const { projects, conversations } = await api("GET", "/api/projects");
  project = projects.find((p) => p.workspaceDir === WORKSPACE);
  if (!project) {
    const created = await api("POST", "/api/projects", {
      name: "OpenX",
      workspaceDir: WORKSPACE,
    });
    project = created.project;
    console.log("[自举] 创建项目:", project.id);
  } else {
    console.log("[自举] 使用已有项目:", project.id, project.name);
  }

  conversation = conversations.find((c) => c.projectId === project.id);
  if (!conversation) {
    const created = await api("POST", `/api/projects/${project.id}/conversations`, {
      title: "自举",
    });
    conversation = created.conversation;
    console.log("[自举] 创建对话:", conversation.id);
  } else {
    console.log("[自举] 使用已有对话:", conversation.id, conversation.title);
  }

  const executors = await api("GET", "/api/executors");
  const prefer = ["acp:codex", "acp:claude", "acp:gemini", "pi"];
  const executorId =
    prefer.find((id) => executors.executors.some((e) => e.id === id && e.available)) ?? "pi";
  console.log("[自举] 执行器:", executorId);

  const userDraft = [
    "OpenX 项目自举验收任务",
    "",
    "你是开发 OpenX 本身的 Agent。工作目录是 OpenX monorepo 根目录。",
    "",
    "验收步骤（必须通过 OpenX REST API 或 openx MCP 工具完成，不要猜接口）：",
    "1. GET /api/catalog — 确认 API 目录可用，记录 endpointCount",
    "2. GET /api/mcp — 确认 openx MCP 已 enabled",
    "3. GET /api/executors — 列出在线执行器",
    "4. GET /api/goals — 列出当前目标",
    "5. 在回复中汇总以上 4 步的 JSON 结果要点",
    "",
    "约束：只调用 OpenX API，不修改业务代码；若使用 ACP 请启用 openx MCP。",
  ].join("\n");

  const { goal } = await api("POST", "/api/goals", {
    conversationId: conversation.id,
    userDraft,
    executorId,
    autoStart: true,
    constraints: [
      "通过 /api/catalog 或 openx_list_apis 发现接口，禁止臆造路径",
      "工作区为 OpenX 仓库根目录",
      "验收完成前不要提交 git",
    ],
  });

  console.log("\n[自举] 目标已创建并启动");
  console.log("  id:", goal.id);
  console.log("  title:", goal.title);
  console.log("  status:", goal.status);
  console.log("  executor:", goal.executorId);
  console.log(`\n  详情: ${BASE}/api/goals/${goal.id}`);
  console.log(`  Web:  http://localhost:5173`);
}

main().catch((err) => {
  console.error("[自举] 失败:", err.message);
  process.exit(1);
});
