/**
 * E2E 验证：Connect 闭环 + auto 执行器路由
 * 用法：node scripts/e2e-connect-auto.mjs
 */
const BASE = "http://127.0.0.1:3921";
const CONNECT_EXECUTOR = "e2e-worker";
const POLL_MS = 2000;
const TIMEOUT_MS = 120_000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function json(path, init) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${body.error ?? res.statusText}`);
  return body;
}

async function waitForGoal(id, predicate, label) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { goal } = await json(`/api/goals/${id}`);
    if (predicate(goal)) return goal;
    await sleep(POLL_MS);
  }
  throw new Error(`${label}: 超时 (${TIMEOUT_MS / 1000}s)`);
}

console.log("\n=== OpenX E2E: Connect + Auto ===\n");

// 1. 确认 Connect Agent 在线
console.log("[1] 检查 executors 列表…");
const { executors } = await json("/api/executors");
const autoEntry = executors.find((e) => e.id === "auto");
const connectEntry = executors.find((e) => e.id === CONNECT_EXECUTOR);
if (!autoEntry) throw new Error("executors 缺少 auto");
console.log(`    auto: ${autoEntry.displayName} (${autoEntry.available ? "可用" : "不可用"})`);
if (!connectEntry) {
  console.warn(`    ⚠ Connect Agent「${CONNECT_EXECUTOR}」未注册，请先运行 connect-client`);
  console.warn("    继续仅验证 auto 路径…");
} else {
  console.log(`    connect: ${connectEntry.displayName} ✓`);
}

// 2. Connect 闭环
if (connectEntry) {
  console.log("\n[2] 创建 Connect Goal 并等待完成…");
  const created = await json("/api/goals", {
    method: "POST",
    body: JSON.stringify({
      userDraft: "E2E Connect 测试：用一句话总结 OpenX 是什么",
      title: "E2E-Connect",
      acceptance: "返回非空结果摘要",
      executionPrompt: "请用一句话说明 OpenX 是做什么的（工头+多执行器派单平台）。",
      executorId: CONNECT_EXECUTOR,
      autoStart: true,
    }),
  });
  const connectGoalId = created.goal.id;
  console.log(`    Goal ${connectGoalId} 已创建，executorId=${created.goal.executorId}`);

  const done = await waitForGoal(
    connectGoalId,
    (g) => g.status === "awaiting_review" || g.status === "failed",
    "Connect Goal",
  );
  const { logs, run } = await json(`/api/goals/${connectGoalId}`);
  const connectLogs = logs.filter((l) => l.message.includes("connect-client") || l.message.includes("Connect"));
  const textEvents = run?.events?.filter((e) => e.type === "text.delta") ?? [];
  const hasLiveText = Boolean(run?.liveText?.trim());
  console.log(`    最终状态: ${done.status}, progress=${done.progress}%`);
  if (done.status === "awaiting_review") {
    console.log(`    结果摘要: ${(done.resultSummary ?? "").slice(0, 120)}…`);
    console.log(`    Connect 相关日志 ${connectLogs.length} 条`);
    console.log(`    Run 事件: text.delta=${textEvents.length}, liveText=${hasLiveText ? "有" : "无"}, active=${run?.active ?? "?"}`);
    if (!hasLiveText && textEvents.length === 0) {
      throw new Error("Connect Run 流为空：未收到 text.delta / liveText");
    }
    console.log("    ✓ Connect 闭环 PASS");
    console.log("    ✓ Connect Run 流 PASS");
  } else {
    const errLog = logs.find((l) => l.level === "error");
    throw new Error(`Connect Goal 失败: ${errLog?.message ?? "unknown"}`);
  }
}

// 3. Auto 执行器路由
console.log("\n[3] 创建 auto Goal 并等待 Pi 路由 + 执行…");
const autoCreated = await json("/api/goals", {
  method: "POST",
  body: JSON.stringify({
    userDraft: "E2E auto 测试：列出当前工作目录下的文件名（只读）",
    title: "E2E-Auto",
    acceptance: "返回目录文件列表或说明",
    executionPrompt: "列出工作目录下的文件和文件夹名称（只读，不要修改任何文件）。",
    executorId: "auto",
    autoStart: true,
  }),
});
const autoGoalId = autoCreated.goal.id;
console.log(`    Goal ${autoGoalId} 已创建，初始 executorId=auto`);

// 等待 executorId 从 auto 物化
let resolved = false;
const deadline = Date.now() + TIMEOUT_MS;
while (Date.now() < deadline) {
  const { goal, logs } = await json(`/api/goals/${autoGoalId}`);
  const routeLog = logs.find((l) => l.message.includes("Pi 自动选择执行器"));
  if (routeLog) {
    console.log(`    ${routeLog.message}`);
    console.log(`    物化后 executorId=${goal.executorId}`);
    resolved = goal.executorId !== "auto";
    if (resolved && (goal.status === "awaiting_review" || goal.status === "failed")) {
      if (goal.status === "awaiting_review") {
        console.log(`    最终状态: awaiting_review`);
        console.log(`    结果摘要: ${(goal.resultSummary ?? "").slice(0, 120)}…`);
        console.log("    ✓ Auto 路由 + 执行 PASS");
      } else {
        const errLog = logs.find((l) => l.level === "error");
        throw new Error(`Auto Goal 执行失败: ${errLog?.message ?? "unknown"}`);
      }
      break;
    }
  }
  if (goal.status === "awaiting_review" && goal.executorId !== "auto") {
    console.log(`    物化 executorId=${goal.executorId}, 状态=awaiting_review`);
    console.log("    ✓ Auto 路由 + 执行 PASS");
    resolved = true;
    break;
  }
  await sleep(POLL_MS);
}
if (!resolved) throw new Error("Auto Goal: 超时或未物化 executorId");

console.log("\n=== E2E 全部通过 ===\n");
