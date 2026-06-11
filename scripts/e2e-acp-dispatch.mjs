/**
 * ACP 派单 E2E：成功 / 失败 / 重试 / Watchdog（单元）
 *
 * 用法：
 *   node scripts/e2e-acp-dispatch.mjs              # Codex + Claude 真实派单
 *   node scripts/e2e-acp-dispatch.mjs --codex-only
 *   node scripts/e2e-acp-dispatch.mjs --skip-live   # 仅跑 watchdog 单元测试
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BASE = process.env.OPENX_BASE ?? "http://127.0.0.1:3921";
const POLL_MS = 3000;
const LIVE_TIMEOUT_MS = Number(process.env.OPENX_E2E_TIMEOUT_MS ?? 180_000);

const codexOnly = process.argv.includes("--codex-only");
const skipLive = process.argv.includes("--skip-live");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function json(path, init) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${path} → ${res.status}: ${body.error ?? res.statusText}`);
  }
  return body;
}

async function waitForGoal(id, predicate, label, timeoutMs = LIVE_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { goal, logs } = await json(`/api/goals/${id}`);
    if (predicate(goal)) return { goal, logs };
    await sleep(POLL_MS);
  }
  const { goal, logs } = await json(`/api/goals/${id}`);
  throw new Error(
    `${label}: 超时 (${timeoutMs / 1000}s)，最终 status=${goal.status} progress=${goal.progress}`,
  );
}

async function resolveConversationId() {
  if (process.env.OPENX_CONVERSATION_ID) return process.env.OPENX_CONVERSATION_ID;
  const { projects, conversations } = await json("/api/projects");
  if (conversations?.length) return conversations[0].id;
  if (!projects?.length) throw new Error("无项目，请先在 UI 创建项目");
  throw new Error("无对话，请先在 UI 创建对话");
}

async function createAndDispatch({
  conversationId,
  executorId,
  title,
  executionPrompt,
}) {
  const created = await json("/api/goals", {
    method: "POST",
    body: JSON.stringify({
      conversationId,
      userDraft: title,
      title,
      acceptance: "返回非空文字结果",
      executionPrompt,
      executorId,
      autoStart: true,
    }),
  });
  return created.goal;
}

function logSection(title) {
  console.log(`\n=== ${title} ===`);
}

function printGoalResult(label, goal, logs) {
  const err = logs?.find((l) => l.level === "error");
  console.log(`  [${label}] status=${goal.status} progress=${goal.progress}%`);
  if (goal.resultSummary) {
    console.log(`  摘要: ${goal.resultSummary.slice(0, 160)}`);
  }
  if (err) console.log(`  错误日志: ${err.message.slice(0, 200)}`);
}

async function testAcpSuccess(conversationId, executorId, label) {
  logSection(`${label} 派单 → 完成`);
  const goal = await createAndDispatch({
    conversationId,
    executorId,
    title: `E2E-${label}-OK`,
    executionPrompt:
      "请用一句中文说明 OpenX 是工头派单系统。不要调用任何工具，不要读写文件，直接文字回复即可。",
  });
  console.log(`  创建 Goal ${goal.id} executor=${goal.executorId}`);

  const { goal: done, logs } = await waitForGoal(
    goal.id,
    (g) =>
      g.status === "awaiting_review" ||
      g.status === "done" ||
      g.status === "failed",
    label,
  );
  printGoalResult(label, done, logs);

  const detail = await json(`/api/goals/${goal.id}`);
  const run = detail.run;
  const textEvents = run?.events?.filter((e) => e.type === "text.delta") ?? [];
  console.log(
    `  Run: events=${run?.events?.length ?? 0} text.delta=${textEvents.length} active=${run?.active ?? "?"} run.end=${run?.events?.some((e) => e.type === "run.end") ?? false}`,
  );

  if (done.status !== "awaiting_review" && done.status !== "done") {
    throw new Error(`${label} 未成功完成: ${done.status}`);
  }
  if (!done.resultSummary?.trim() && textEvents.length === 0 && !run?.liveText?.trim()) {
    throw new Error(`${label} 无有效输出`);
  }
  console.log(`  ✓ ${label} 成功 PASS`);
  return goal.id;
}

async function testAcpFailure(conversationId) {
  logSection("不可用 ACP (acp:gemini) 派单 → 失败");
  const goal = await createAndDispatch({
    conversationId,
    executorId: "acp:gemini",
    title: "E2E-Gemini-Fail",
    executionPrompt: "这应该失败，因为 gemini CLI 未安装。",
  });
  console.log(`  创建 Goal ${goal.id}`);

  const { goal: done, logs } = await waitForGoal(
    goal.id,
    (g) => g.status === "failed" || g.status === "awaiting_review",
    "Gemini-Fail",
    90_000,
  );
  printGoalResult("Gemini", done, logs);

  if (done.status !== "failed") {
    console.log("  ⚠ Gemini 意外成功（可能已安装），跳过失败断言");
    return null;
  }
  console.log("  ✓ 失败路径 PASS");
  return goal.id;
}

async function testRetry(failedGoalId) {
  if (!failedGoalId) {
    console.log("\n=== 失败重试 ===\n  跳过（无 failed goal）");
    return;
  }
  logSection("failed → retry → 再次失败或完成");
  await json(`/api/goals/${failedGoalId}/retry`, { method: "POST" });
  const { goal, logs } = await waitForGoal(
    failedGoalId,
    (g) => g.status === "failed" || g.status === "awaiting_review" || g.status === "done",
    "Retry",
    90_000,
  );
  printGoalResult("Retry", goal, logs);
  console.log(`  ✓ retry API 可用，最终 status=${goal.status}`);
}

async function runWatchdogUnitTests() {
  logSection("Watchdog 单元测试（ACP / Connect 超时）");
  await new Promise((resolve, reject) => {
    const proc = spawn(
      "pnpm",
      [
        "--filter",
        "@openx/server",
        "exec",
        "vitest",
        "run",
        "src/acp-watchdog.test.ts",
        "src/connect-watchdog.test.ts",
      ],
      { cwd: ROOT, shell: true, stdio: "inherit" },
    );
    proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`watchdog tests exit ${code}`))));
  });
  console.log("  ✓ Watchdog 单元 PASS");
}

async function printPreflight(conversationId) {
  logSection("预检");
  const { executors } = await json("/api/executors");
  for (const id of ["acp:codex", "acp:claude", "acp:gemini"]) {
    const ex = executors.find((e) => e.id === id);
    console.log(`  ${id}: ${ex?.available ? "可用" : "不可用"} ${ex?.hint ?? ""}`);
  }
  for (const id of ["acp:codex", "acp:claude"]) {
    const { config } = await json(`/api/cli/acp-config/${encodeURIComponent(id)}`);
    console.log(
      `  ${id} 绑定: ${config.modelRef ?? "未绑定"} synced=${config.synced} ready=${config.modelReady}`,
    );
  }
  console.log(`  对话: ${conversationId}`);
}

async function main() {
  console.log(`OpenX ACP 派单 E2E → ${BASE}`);
  await runWatchdogUnitTests();

  if (skipLive) {
    console.log("\n--skip-live：跳过真实 Codex/Claude 派单\n");
    return;
  }

  const conversationId = await resolveConversationId();
  await printPreflight(conversationId);

  await testAcpSuccess(conversationId, "acp:codex", "Codex");
  if (!codexOnly) {
    await testAcpSuccess(conversationId, "acp:claude", "Claude");
  }
  const failedId = await testAcpFailure(conversationId);
  await testRetry(failedId);

  console.log("\n=== 全部 E2E 通过 ===\n");
}

main().catch((err) => {
  console.error("\nE2E 失败:", err.message);
  process.exit(1);
});
