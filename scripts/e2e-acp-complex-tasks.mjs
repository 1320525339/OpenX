#!/usr/bin/env node
/**
 * ACP 复杂派单 E2E（Codex + Claude，Mimo mimo-v2.5-pro）
 *
 * 用法:
 *   node scripts/e2e-acp-complex-tasks.mjs
 *   node scripts/e2e-acp-complex-tasks.mjs --codex-only
 *   node scripts/e2e-acp-complex-tasks.mjs --claude-only
 *
 * 环境变量: OPENX_BASE, OPENX_E2E_TIMEOUT_MS（默认 900000）
 * Codex 任务需先启动 Responses 代理；Claude 直连上游，无需代理。
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ARTIFACTS = join(ROOT, "scripts", "e2e-artifacts");
const BASE = process.env.OPENX_BASE ?? "http://127.0.0.1:3921";
const TIMEOUT_MS = Number(process.env.OPENX_E2E_TIMEOUT_MS ?? 900_000);
const POLL_MS = 4000;

const codexOnly = process.argv.includes("--codex-only");
const claudeOnly = process.argv.includes("--claude-only");

const TASKS = [
  {
    id: "codex-foreman-constant",
    executorId: "acp:codex",
    title: "复杂-工头常量提取",
    executionPrompt: `在仓库根目录完成以下任务（必须用工具读文件，不要猜测）：
1. 打开 packages/shared/src/coach-agents.ts
2. 找到工头（foreman）对应的 agent 常量名及其字符串值
3. 将结果写入 scripts/e2e-artifacts/foreman-codex.txt，格式严格为两行：
   NAME=<常量名>
   VALUE=<常量值>
4. 在 resultSummary 中用中文说明 NAME 和 VALUE`,
    verify() {
      const p = join(ARTIFACTS, "foreman-codex.txt");
      if (!existsSync(p)) throw new Error("缺少 foreman-codex.txt");
      const text = readFileSync(p, "utf8");
      if (!/NAME=FOREMAN_AGENT_ID/.test(text)) throw new Error("NAME 不正确");
      if (!/VALUE=coach/.test(text)) throw new Error("VALUE 应为 coach");
    },
  },
  {
    id: "claude-acp-route",
    executorId: "acp:claude",
    title: "复杂-ACP 路由解析",
    executionPrompt: `在仓库根目录完成（必须读源码）：
1. 阅读 apps/server/src/routes/cli.ts，找出更新 acp-config 的 HTTP 方法与路径模式
2. 写入 scripts/e2e-artifacts/acp-route-claude.txt，两行：
   METHOD=<大写方法>
   PATH=<路径模式，含 :executorId 占位>
3. resultSummary 用中文复述 METHOD 与 PATH`,
    verify() {
      const p = join(ARTIFACTS, "acp-route-claude.txt");
      if (!existsSync(p)) throw new Error("缺少 acp-route-claude.txt");
      const text = readFileSync(p, "utf8");
      if (!/METHOD=PUT/i.test(text)) throw new Error("METHOD 应为 PUT");
      if (!/PATH=.*acp-config/i.test(text)) throw new Error("PATH 应含 acp-config");
    },
  },
  {
    id: "codex-mini-module",
    executorId: "acp:codex",
    title: "复杂-小模块实现",
    executionPrompt: `在 scripts/e2e-artifacts/ 下创建 mini-sum.mjs：
- 导出函数 sum(a, b) 返回两数之和
- 文件末尾用 if (import.meta.url === ...) 形式自测：console.log(sum(2,3)===5 ? 'OK' : 'FAIL')
- 在终端运行 node scripts/e2e-artifacts/mini-sum.mjs，确认输出 OK
- resultSummary 写明「mini-sum 自测 OK」`,
    verify() {
      const p = join(ARTIFACTS, "mini-sum.mjs");
      if (!existsSync(p)) throw new Error("缺少 mini-sum.mjs");
      const text = readFileSync(p, "utf8");
      if (!/export\s+function\s+sum/.test(text) && !/export\s*\{[^}]*sum/.test(text)) {
        throw new Error("mini-sum.mjs 应导出 sum");
      }
    },
  },
  {
    id: "claude-cross-search",
    executorId: "acp:claude",
    title: "复杂-跨文件检索",
    executionPrompt: `在仓库内搜索 resolveCodexWireApi 函数定义在哪个文件（用搜索/读文件工具，不要编造）：
1. 将「相对仓库根的路径」写入 scripts/e2e-artifacts/wire-api-claude.txt（仅一行路径，无多余文字）
2. resultSummary 说明该函数用途（一句话中文）`,
    verify() {
      const p = join(ARTIFACTS, "wire-api-claude.txt");
      if (!existsSync(p)) throw new Error("缺少 wire-api-claude.txt");
      const rel = readFileSync(p, "utf8").trim().replace(/\\/g, "/");
      if (!rel.includes("acp-cli-config")) {
        throw new Error(`路径异常: ${rel}`);
      }
    },
  },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

async function resolveConversationId() {
  const workspace = process.env.OPENX_WORKSPACE ?? ROOT;
  let { projects, conversations } = await api("GET", "/api/projects");
  let project = projects.find((p) => p.workspaceDir === workspace) ?? projects[0];
  if (!project) {
    const created = await api("POST", "/api/projects", {
      name: "OpenX E2E",
      workspaceDir: workspace,
    });
    project = created.project;
  }
  let conv = conversations.find((c) => c.projectId === project.id);
  if (!conv) {
    const created = await api("POST", `/api/projects/${project.id}/conversations`, {
      title: "ACP 复杂任务",
    });
    conv = created.conversation;
  }
  return conv.id;
}

async function waitForGoal(id, label) {
  const deadline = Date.now() + TIMEOUT_MS;
  let lastLog = "";
  while (Date.now() < deadline) {
    const { goal, logs } = await api("GET", `/api/goals/${id}`);
    const tail = logs[logs.length - 1];
    if (tail && tail.message !== lastLog) {
      lastLog = tail.message;
      console.log(`  [${goal.status} ${goal.progress}%] ${tail.message.slice(0, 120)}`);
    }
    if (["awaiting_review", "done", "failed", "cancelled"].includes(goal.status)) {
      return { goal, logs };
    }
    await sleep(POLL_MS);
  }
  throw new Error(`${label}: 超时 ${TIMEOUT_MS / 1000}s`);
}

async function runTask(conversationId, task) {
  console.log(`\n=== ${task.id} (${task.executorId}) ===`);
  const { goal } = await api("POST", "/api/goals", {
    conversationId,
    userDraft: task.title,
    title: task.title,
    acceptance: "产物文件符合格式且任务完成",
    executionPrompt: task.executionPrompt,
    executorId: task.executorId,
    autoStart: true,
  });
  console.log(`  Goal ${goal.id}`);

  const { goal: done, logs } = await waitForGoal(goal.id, task.id);
  if (done.status === "failed" || done.status === "cancelled") {
    const err = logs.find((l) => l.level === "error");
    throw new Error(
      `${task.id} 失败: ${err?.message?.slice(0, 300) ?? done.status}`,
    );
  }
  if (done.resultSummary) {
    console.log(`  摘要: ${done.resultSummary.slice(0, 200)}`);
  }
  task.verify();
  console.log(`  ✓ ${task.id} PASS`);
}

async function ensureCodexProxy() {
  const res = await fetch(`${BASE}/api/cli/codex-proxy/health`);
  const data = await res.json().catch(() => ({}));
  if (data.ok) return;
  throw new Error(
    `Codex Responses 代理未运行 (port ${data.port ?? "8788"})。请先: node scripts/start-codex-proxy.mjs`,
  );
}

async function main() {
  console.log(`ACP 复杂任务 E2E → ${BASE} (timeout ${TIMEOUT_MS / 1000}s)`);

  if (existsSync(ARTIFACTS)) rmSync(ARTIFACTS, { recursive: true, force: true });
  mkdirSync(ARTIFACTS, { recursive: true });

  const conversationId = await resolveConversationId();

  const willRunCodex = !claudeOnly;
  if (willRunCodex) await ensureCodexProxy();

  for (const id of ["acp:codex", "acp:claude"]) {
    const { config } = await api("GET", `/api/cli/acp-config/${encodeURIComponent(id)}`);
    console.log(`  ${id}: ${config.modelRef ?? "未绑定"} synced=${config.synced}`);
    if (!config.modelReady || !config.synced) {
      throw new Error(`${id} 未绑定渠道/模型，请先在工具页配置 ACP API`);
    }
  }

  let tasks = TASKS;
  if (codexOnly) tasks = tasks.filter((t) => t.executorId === "acp:codex");
  if (claudeOnly) tasks = tasks.filter((t) => t.executorId === "acp:claude");

  for (const task of tasks) {
    await runTask(conversationId, task);
  }

  console.log("\n=== 全部复杂任务通过 ===\n");
}

main().catch((e) => {
  console.error("\n复杂任务 E2E 失败:", e.message);
  process.exit(1);
});
