/**
 * 自动跑通：Mock 任务 → 待验收 → 灵动岛 → 返工 → 再验收 → 确认完成
 * 并校验三态 / 返工 Tab 筛选逻辑。
 */
const BASE = process.env.OPENX_API ?? "http://127.0.0.1:3921";
const CONV = "openx-system-main";
const TIMEOUT_MS = 90_000;

const results = [];

function step(name, ok, detail = "") {
  results.push({ name, ok, detail });
  const mark = ok ? "✓" : "✗";
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function json(path, init) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function waitForStatus(goalId, targets, timeoutMs = TIMEOUT_MS) {
  const want = new Set(Array.isArray(targets) ? targets : [targets]);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { goal } = await json(`/api/goals/${goalId}`);
    if (want.has(goal.status)) return goal;
    if (goal.status === "failed" && !want.has("failed")) {
      throw new Error(`goal failed: ${goal.resultSummary ?? ""}`);
    }
    await sleep(500);
  }
  const { goal } = await json(`/api/goals/${goalId}`);
  throw new Error(`timeout waiting ${[...want].join("|")}, last=${goal.status}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function goalDisplayOutcome(goal) {
  if (goal.status === "done") return "done";
  if (goal.status === "failed" || goal.status === "cancelled") return "failed";
  return "incomplete";
}

function goalMatchesDisplayFilter(goal, filter) {
  if (filter === "all") return true;
  if (filter === "incomplete") return goalDisplayOutcome(goal) === "incomplete";
  if (filter === "failed") return goalDisplayOutcome(goal) === "failed";
  if (filter === "done") return goalDisplayOutcome(goal) === "done";
  if (filter === "rework") {
    return goal.status === "running" && goal.effectStatus === "rework";
  }
  return goal.status === filter;
}

async function main() {
  console.log("=== OpenX 灵动岛 / 三态 自动验收 ===");
  console.log("API:", BASE);

  const health = await json("/api/health");
  step("health", health.ok === true);

  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const tokenPath = path.join(os.homedir(), ".openx", "internal.token");
  const internalToken =
    process.env.OPENX_INTERNAL_TOKEN?.trim() ||
    (fs.existsSync(tokenPath) ? fs.readFileSync(tokenPath, "utf8").trim() : "");

  const islandRes = await fetch(`${BASE}/api/system/island/push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(internalToken ? { "x-openx-internal-token": internalToken } : {}),
    },
    body: JSON.stringify({
      kind: "broadcast",
      id: `e2e-island-${Date.now()}`,
      severity: "info",
      title: "自动验收",
      message: "灵动岛协议推送正常",
    }),
  });
  const island = await islandRes.json().catch(() => ({}));
  step(
    "island_push",
    islandRes.ok && island.ok === true,
    `status=${islandRes.status} id=${island.id ?? ""}`,
  );

  const { goal: created } = await json("/api/goals", {
    method: "POST",
    body: JSON.stringify({
      conversationId: CONV,
      userDraft: "自动验收：灵动岛与三态筛选",
      title: `E2E 灵动岛 ${new Date().toLocaleTimeString("zh-CN")}`,
      acceptance: "Mock 执行完成并进入待验收",
      executionPrompt: "只回复 OK",
      executorId: "pi",
      autoStart: true,
      autoReview: false,
    }),
  });
  step("goal_create", Boolean(created?.id), `id=${created?.id} status=${created?.status}`);

  const awaiting = await waitForStatus(created.id, "awaiting_review");
  step("goal_awaiting_review", awaiting.status === "awaiting_review", awaiting.title);

  const { goals: pool } = await json(`/api/goals?conversationId=${CONV}`);
  const incompleteN = pool.filter((g) => goalMatchesDisplayFilter(g, "incomplete")).length;
  const reworkN = pool.filter((g) => goalMatchesDisplayFilter(g, "rework")).length;
  step(
    "filter_incomplete",
    pool.some((g) => g.id === created.id && goalMatchesDisplayFilter(g, "incomplete")),
    `incomplete=${incompleteN}`,
  );
  step(
    "filter_rework_before",
    !pool.some((g) => g.id === created.id && goalMatchesDisplayFilter(g, "rework")),
    `rework=${reworkN}`,
  );

  const reworkRes = await json(`/api/goals/${created.id}/rework`, {
    method: "POST",
    body: JSON.stringify({ reason: "请把标题改成包含【已返工】" }),
  });
  const reworked = reworkRes.goal ?? reworkRes;
  step(
    "goal_rework",
    reworked.status === "running" && reworked.effectStatus === "rework",
    `status=${reworked.status} effect=${reworked.effectStatus}`,
  );

  step(
    "filter_rework_running",
    goalMatchesDisplayFilter(reworked, "rework"),
    "返工瞬间应为 running+rework",
  );

  const afterRework = await waitForStatus(created.id, "awaiting_review");
  step("goal_rework_cycle", afterRework.status === "awaiting_review");

  const { goals: pool2 } = await json(`/api/goals?conversationId=${CONV}`);
  step(
    "filter_rework_after_running",
    !pool2.some((g) => g.id === created.id && goalMatchesDisplayFilter(g, "rework")),
    "返工完成后不应留在返工 Tab",
  );

  const approveRes = await json(`/api/goals/${created.id}/approve`, { method: "POST" });
  const doneGoal = approveRes.goal ?? (await json(`/api/goals/${created.id}`)).goal;
  step("goal_approve_direct", doneGoal.status === "done", "无二次确认 API 直完成");

  const { goals: pool3 } = await json(`/api/goals?conversationId=${CONV}`);
  step(
    "filter_done",
    pool3.some((g) => g.id === created.id && goalMatchesDisplayFilter(g, "done")),
  );

  const failed = results.filter((r) => !r.ok);
  console.log("\n--- 汇总 ---");
  console.log(`通过 ${results.length - failed.length}/${results.length}`);
  if (failed.length) {
    console.error("失败项:", failed.map((f) => f.name).join(", "));
    process.exit(1);
  }
  console.log("全部通过。goalId=", created.id);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
