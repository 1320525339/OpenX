#!/usr/bin/env node
/**
 * Miloco × OpenX batch3 smoke: home-profile list CLI + read-only Pi Goal.
 */

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.OPENX_API_BASE ?? process.env.OPENX_BASE_URL ?? "http://127.0.0.1:3921";
const POLL_MS = 2_000;
const SMOKE_TIMEOUT_MS = Number(process.env.MILOCO_BATCH3_SMOKE_TIMEOUT_MS ?? 180_000);

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
  "miloco-home-profile",
  "miloco-perception-digest",
  "miloco-home-patrol",
  "miloco-home-observe",
  "miloco-home-promote",
  "miloco-home-prune",
  "miloco-habit-suggest",
];

const BATCH3_SKILLS = [
  "miloco-home-profile",
  "miloco-perception-digest",
  "miloco-home-patrol",
  "miloco-home-observe",
  "miloco-home-promote",
  "miloco-home-prune",
  "miloco-habit-suggest",
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
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

async function ensureConversationId() {
  const projects = await get("/api/projects");
  const projectId = projects.data.projects?.[0]?.id;
  if (!projectId) throw new Error("No projects found");
  const conv = await post(`/api/projects/${projectId}/conversations`, {
    title: `Miloco batch3 smoke ${new Date().toISOString().slice(0, 16)}`,
  });
  if (conv.status !== 201) throw new Error(`Failed to create conversation: ${conv.text}`);
  return conv.data.conversation.id;
}

async function waitForGoalStatus(goalId, statuses) {
  const deadline = Date.now() + SMOKE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await get(`/api/goals/${goalId}`);
    if (res.status !== 200) throw new Error(res.text);
    const goal = res.data.goal;
    if (statuses.includes(goal.status)) return { goal, logs: res.data.logs ?? [] };
    await sleep(POLL_MS);
  }
  throw new Error(`Goal ${goalId} timeout`);
}

async function preflight() {
  console.log("\n--- Preflight ---\n");
  const setup = await post("/api/miloco/setup", { force: false });
  if (setup.status === 200 && setup.data.ok) ok("Miloco setup OK");
  else fail(`Miloco setup: ${setup.status}`);

  const status = await get("/api/miloco/status");
  if (status.status !== 200) {
    fail(`status: ${status.status}`);
    return;
  }
  const syncInstalled = status.data.syncSkillsInstalled ?? [];
  if (syncInstalled.length >= SYNC_SKILLS.length) {
    ok(`Sync skills: ${syncInstalled.length}`);
  } else {
    fail(`Expected >=${SYNC_SKILLS.length} skills, got ${syncInstalled.length}`);
  }
  const b3 = status.data.batch3SkillsInstalled ?? [];
  if (b3.length >= BATCH3_SKILLS.length) ok(`Batch3 installed: ${b3.length}`);
  else fail(`Batch3 expected ${BATCH3_SKILLS.length}, got ${b3.length}`);
  const b3bound = status.data.batch3SkillsBoundToPi ?? [];
  if (b3bound.length >= BATCH3_SKILLS.length) ok(`Batch3 bound to pi`);
  else fail(`Batch3 bind expected ${BATCH3_SKILLS.length}`);
}

async function stepHomeProfileCli() {
  console.log("\n--- home-profile list CLI ---\n");
  const result = runWslMiloco(["home-profile", "list", "--target", "profile"]);
  if (result.ok) ok("home-profile list succeeded");
  else fail(result.stderr || result.stdout);
}

async function stepReadOnlyGoal(conversationId) {
  console.log("\n--- home-profile read-only Goal ---\n");
  const created = await post("/api/goals", {
    conversationId,
    userDraft: "只读查询家庭档案，不要写入",
    title: "Miloco batch3 smoke：家庭档案只读",
    acceptance: "返回 home-profile list 中文摘要，无写操作",
    executionPrompt: [
      "加载 miloco-home-profile skill。",
      "通过 miloco-wsl.ps1 执行 home-profile list --target profile。",
      "用中文汇总档案条目数量与类型。",
      "禁止 profile-write / commit。",
      "说明批次三 cron Skills 已安装，定时任务需 OPENX_MILOCO_HOME_CRON_WATCH=1。",
    ].join("\n"),
    executorId: "pi",
    autoStart: true,
    autoReview: false,
    refinedMessageId: 1,
    dispatchContext: { skillIds: SYNC_SKILLS },
  });
  if (created.status !== 201) {
    fail(`POST /api/goals: ${created.status}`);
    return;
  }
  const goalId = created.data.goal.id;
  ok(`Goal created: ${goalId}`);
  try {
    const { goal } = await waitForGoalStatus(goalId, ["awaiting_review", "done", "failed"]);
    if (goal.status === "awaiting_review" || goal.status === "done") ok(`Goal ${goal.status}`);
    else fail(`Goal failed: ${goal.status}`);
  } catch (err) {
    fail(String(err));
  }
}

async function main() {
  console.log(`Miloco batch3 smoke — ${BASE}`);
  await preflight();
  if (failed) process.exit(1);
  await stepHomeProfileCli();
  if (failed) process.exit(1);
  const conversationId = await ensureConversationId();
  await stepReadOnlyGoal(conversationId);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
