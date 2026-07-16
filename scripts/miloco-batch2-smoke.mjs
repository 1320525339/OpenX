#!/usr/bin/env node
/**
 * Miloco × OpenX batch2 smoke: task list CLI + read-only Pi Goal (task + person list).
 *
 * Prerequisites:
 *   - OpenX server running WITHOUT OPENX_MOCK_PI=1
 *   - pnpm miloco:setup (syncs 9 Miloco skills)
 *   - WSL Miloco installed and account bound
 *
 * Usage:
 *   node scripts/miloco-batch2-smoke.mjs
 *   MILOCO_BATCH2_SMOKE_TIMEOUT_MS=180000 node scripts/miloco-batch2-smoke.mjs
 */

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.OPENX_API_BASE ?? process.env.OPENX_BASE_URL ?? "http://127.0.0.1:3921";
const POLL_MS = 2_000;
const SMOKE_TIMEOUT_MS = Number(process.env.MILOCO_BATCH2_SMOKE_TIMEOUT_MS ?? 180_000);

const SYNC_SKILLS = [
  "miloco-devices",
  "miloco-miot-scope",
  "miloco-miot-admin",
  "miloco-notify",
  "miloco-perception",
  "miloco-create-task",
  "miloco-terminate-task",
  "miloco-miot-identity",
  "miloco-miot-identity-register",
];

const BATCH2_SKILLS = [
  "miloco-create-task",
  "miloco-terminate-task",
  "miloco-miot-identity",
  "miloco-miot-identity-register",
];

let failed = 0;

function ok(msg) {
  console.log(`✓ ${msg}`);
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  failed += 1;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data, text };
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data, text };
}

function runWslMiloco(args) {
  const ps1 = join(ROOT, "scripts", "miloco-wsl.ps1");
  const result = spawnSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1, ...args],
    { encoding: "utf8", cwd: ROOT },
  );
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

async function ensureConversationId() {
  const projects = await get("/api/projects");
  if (projects.status !== 200 || !projects.data.projects?.length) {
    throw new Error("No projects found — create a project in OpenX first");
  }
  const projectId = projects.data.projects[0].id;
  const conv = await post(`/api/projects/${projectId}/conversations`, {
    title: `Miloco batch2 smoke ${new Date().toISOString().slice(0, 16)}`,
  });
  if (conv.status !== 201 || !conv.data.conversation?.id) {
    throw new Error(`Failed to create conversation: ${conv.status} ${conv.text}`);
  }
  return conv.data.conversation.id;
}

async function waitForGoalStatus(goalId, statuses, timeoutMs = SMOKE_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await get(`/api/goals/${goalId}`);
    if (res.status !== 200) throw new Error(`GET goal failed: ${res.text}`);
    const goal = res.data.goal;
    const logs = res.data.logs ?? [];
    if (statuses.includes(goal.status)) return { goal, logs };
    await sleep(POLL_MS);
  }
  const final = await get(`/api/goals/${goalId}`);
  throw new Error(
    `Goal ${goalId} timeout after ${timeoutMs}ms, status=${final.data.goal?.status}`,
  );
}

async function preflight() {
  console.log("\n--- Preflight ---\n");

  const health = await get("/api/health");
  if (health.status === 200 && health.data.ok) ok("OpenX /api/health");
  else fail(`OpenX health: ${health.status} ${health.text}`);

  const executors = await get("/api/executors");
  if (executors.status === 200) {
    const pi = executors.data.executors?.find((e) => e.id === "pi");
    if (pi?.available) {
      if (String(pi.displayName ?? "").includes("Mock")) {
        fail("Pi is Mock — start server without OPENX_MOCK_PI=1");
      } else {
        ok(`Pi available: ${pi.displayName ?? "pi"}`);
      }
    } else {
      fail("Pi executor not available");
    }
  } else {
    fail(`GET /api/executors: ${executors.status}`);
  }

  const setup = await post("/api/miloco/setup", { force: false });
  if (setup.status === 200 && setup.data.ok) ok("Miloco setup OK");
  else fail(`Miloco setup failed: ${setup.status} ${setup.text}`);

  const status = await get("/api/miloco/status");
  if (status.status !== 200) {
    fail(`GET /api/miloco/status: ${status.status}`);
    return;
  }

  const syncInstalled = status.data.syncSkillsInstalled ?? status.data.skillsInstalled ?? [];
  if (syncInstalled.length >= SYNC_SKILLS.length) {
    ok(`Sync skills installed: ${syncInstalled.length}`);
  } else {
    fail(`Expected >=${SYNC_SKILLS.length} sync skills, got ${syncInstalled.length}`);
  }

  const batch2Installed = status.data.batch2SkillsInstalled ?? [];
  if (batch2Installed.length >= BATCH2_SKILLS.length) {
    ok(`Batch2 skills installed: ${batch2Installed.join(", ")}`);
  } else {
    fail(`Expected ${BATCH2_SKILLS.length} batch2 skills, got ${batch2Installed.length}`);
  }

  const batch2Bound = status.data.batch2SkillsBoundToPi ?? [];
  if (batch2Bound.length >= BATCH2_SKILLS.length) {
    ok(`Batch2 skills bound to pi: ${batch2Bound.join(", ")}`);
  } else {
    fail(`Expected ${BATCH2_SKILLS.length} batch2 skills bound to pi`);
  }
}

async function stepTaskListCli() {
  console.log("\n--- Step B: task list CLI ---\n");

  const result = runWslMiloco(["task", "list"]);
  if (result.ok) {
    ok("miloco-cli task list succeeded");
  } else {
    fail(`task list failed (exit ${result.status}): ${result.stderr || result.stdout}`);
  }
}

async function stepReadOnlyGoal(conversationId) {
  console.log("\n--- Step C: task + person list Goal ---\n");

  const goalPayload = {
    conversationId,
    userDraft: "列出当前 Miloco 任务与家庭成员，只读查询，不要创建或删除任何内容",
    title: "Miloco batch2 smoke：任务与成员只读查询",
    acceptance:
      "返回 task list 与 person list 的中文摘要；未执行任何创建/删除/修改操作",
    executionPrompt: [
      "加载 miloco-create-task 与 miloco-miot-identity skill（只读查询路径）。",
      "通过 scripts/miloco-wsl.ps1 执行 task list 与 person list。",
      "用中文汇总任务数量/标识与家庭成员列表。",
      "禁止 task create/delete、person 增删改、identity register 等写操作。",
    ].join("\n"),
    executorId: "pi",
    autoStart: true,
    autoReview: false,
    refinedMessageId: 1,
    dispatchContext: {
      skillIds: SYNC_SKILLS,
    },
  };

  const created = await post("/api/goals", goalPayload);
  if (created.status !== 201 || !created.data.goal?.id) {
    fail(`POST /api/goals failed: ${created.status} ${created.text}`);
    return;
  }

  const goalId = created.data.goal.id;
  ok(`Goal created: ${goalId}`);

  try {
    const { goal, logs } = await waitForGoalStatus(goalId, [
      "awaiting_review",
      "done",
      "failed",
    ]);
    if (goal.status === "awaiting_review" || goal.status === "done") {
      ok(`Goal reached ${goal.status}`);
    } else {
      fail(`Goal failed: ${goal.status}`);
      return;
    }

    const logText = logs.map((l) => l.message ?? "").join("\n");
    const summary = goal.resultSummary ?? "";
    const combined = `${logText}\n${summary}`;

    if (logText.includes("[pi]")) ok("Goal logs contain [pi]");
    else fail("Goal logs missing [pi] marker");

    if (/task list|person list|miloco-wsl/i.test(combined)) {
      ok("Goal output suggests task/person list execution");
    } else {
      fail("Goal output missing task list / person list markers");
    }
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

async function main() {
  console.log(`Miloco batch2 smoke — ${BASE}`);
  console.log(`Poll timeout: ${SMOKE_TIMEOUT_MS}ms`);

  await preflight();
  if (failed > 0) {
    console.error(`\n${failed} preflight failure(s) — aborting.`);
    process.exit(1);
  }

  await stepTaskListCli();
  if (failed > 0) {
    console.error(`\n${failed} failure(s) after task list CLI.`);
    process.exit(1);
  }

  const conversationId = await ensureConversationId();
  ok(`Using conversation ${conversationId}`);
  await stepReadOnlyGoal(conversationId);

  if (failed === 0) {
    console.log("\n全部 batch2 smoke 通过。");
  } else {
    console.error(`\n${failed} 项失败。`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
