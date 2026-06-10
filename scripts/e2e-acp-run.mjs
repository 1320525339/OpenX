/**
 * E2E 验证：ACP runtime Run 事件流
 *
 * 用法：
 *   node scripts/e2e-acp-run.mjs           # 自动：无 TTY 时用 Mock Agent
 *   node scripts/e2e-acp-run.mjs --mock    # 强制 Mock（完整 Run 管道）
 *   node scripts/e2e-acp-run.mjs --real    # 强制真实 ACP CLI（需交互终端 + 已登录）
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DEFAULT_BASE = "http://127.0.0.1:3921";
const MOCK_PORT = 3922;
const POLL_MS = 2000;
const TIMEOUT_MS = 120_000;

const forceMock = process.argv.includes("--mock");
const forceReal = process.argv.includes("--real");
const useMock = forceMock || (!forceReal && !process.stdin.isTTY);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHttp(base, path = "/api/executors") {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}${path}`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await sleep(500);
  }
  throw new Error(`服务未就绪: ${base}`);
}

function startMockServer() {
  const proc = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: join(ROOT, "apps/server"),
    env: {
      ...process.env,
      PORT: String(MOCK_PORT),
      OPENX_ACP_MOCK: "1",
      OPENX_DB_PATH: ":memory:",
    },
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return proc;
}

async function json(base, path, init) {
  const res = await fetch(`${base}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${body.error ?? res.statusText}`);
  return body;
}

async function waitForGoal(base, id, predicate, label) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { goal } = await json(base, `/api/goals/${id}`);
    if (predicate(goal)) return goal;
    await sleep(POLL_MS);
  }
  throw new Error(`${label}: 超时 (${TIMEOUT_MS / 1000}s)`);
}

async function runE2e(base, modeLabel) {
  console.log(`\n=== OpenX E2E: ACP Run 流 (${modeLabel}) ===\n`);

  console.log("[1] 检查可用 ACP runtime…");
  const { executors } = await json(base, "/api/executors");
  const acpCandidates = executors.filter((e) => e.id.startsWith("acp:"));
  const acp = acpCandidates.find((e) => e.available);
  if (!acp) {
    console.error("    无可用 ACP runtime。已检测：");
    for (const c of acpCandidates) {
      console.error(`      ${c.id}: ${c.hint ?? "不可用"}`);
    }
    throw new Error("无可用 ACP runtime");
  }
  console.log(`    选用 ${acp.id}: ${acp.displayName} ✓`);

  console.log("\n[2] 创建 ACP Goal 并等待完成…");
  const created = await json(base, "/api/goals", {
    method: "POST",
    body: JSON.stringify({
      userDraft: "E2E ACP 测试：用一句话说明 OpenX 是什么",
      title: "E2E-ACP-Run",
      acceptance: "返回非空结果",
      executionPrompt:
        "请用一句话说明 OpenX 是工头派单 + 多执行器协同平台。不要调用工具，不要读写文件，直接文字回复。",
      executorId: acp.id,
      autoStart: true,
    }),
  });
  const goalId = created.goal.id;
  console.log(`    Goal ${goalId} 已创建，executorId=${created.goal.executorId}`);

  const done = await waitForGoal(
    base,
    goalId,
    (g) => g.status === "awaiting_review" || g.status === "failed",
    "ACP Goal",
  );

  const { logs, run } = await json(base, `/api/goals/${goalId}`);
  const textEvents = run?.events?.filter((e) => e.type === "text.delta") ?? [];
  const toolStarts = run?.events?.filter((e) => e.type === "tool.start") ?? [];
  const thoughts = run?.events?.filter(
    (e) => e.type === "status" && String(e.message).startsWith("思考 ›"),
  ) ?? [];
  const hasEnd = run?.events?.some((e) => e.type === "run.end") ?? false;

  console.log(`    最终状态: ${done.status}, progress=${done.progress}%`);
  if (done.status !== "awaiting_review") {
    const errLog = logs.find((l) => l.level === "error");
    throw new Error(`ACP Goal 失败: ${errLog?.message ?? "unknown"}`);
  }

  console.log(`    结果摘要: ${(done.resultSummary ?? "").slice(0, 120)}…`);
  console.log(
    `    Run 事件: total=${run?.events?.length ?? 0} text.delta=${textEvents.length} tool.start=${toolStarts.length} 思考=${thoughts.length} run.end=${hasEnd} active=${run?.active}`,
  );

  if (!hasEnd || run?.active) {
    throw new Error("Run 未正常结束（缺少 run.end 或 active=true）");
  }
  if (!run?.liveText?.trim() && textEvents.length === 0) {
    throw new Error("ACP Run 流为空：未收到 text.delta / liveText");
  }
  if (toolStarts.length === 0) {
    throw new Error("ACP Run 流缺少 tool.start");
  }
  if (thoughts.length === 0) {
    throw new Error("ACP Run 流缺少思考 status（agent_thought_chunk）");
  }

  console.log("    ✓ ACP 闭环 PASS");
  console.log("    ✓ ACP Run 流 PASS");
  console.log("\n=== E2E 全部通过 ===\n");
}

let mockServer;
try {
  if (useMock) {
    console.log("启动 Mock ACP 专用 server（OPENX_ACP_MOCK=1, PORT=3922）…");
    mockServer = startMockServer();
    const base = `http://127.0.0.1:${MOCK_PORT}`;
    await waitForHttp(base);
    await runE2e(base, "Mock Agent");
  } else {
    await waitForHttp(DEFAULT_BASE);
    await runE2e(DEFAULT_BASE, "真实 ACP CLI");
  }
} finally {
  if (mockServer && !mockServer.killed) {
    mockServer.kill("SIGTERM");
  }
}
