#!/usr/bin/env node
/**
 * Miloco × OpenX smoke test (route 3): notify CLI + device list Goal via real Pi.
 *
 * Prerequisites:
 *   - OpenX server running WITHOUT OPENX_MOCK_PI=1
 *   - Pi LLM configured
 *   - WSL Miloco installed and account bound
 *
 * Usage:
 *   node scripts/miloco-smoke-goals.mjs
 *   MILOCO_SMOKE_TIMEOUT_MS=180000 node scripts/miloco-smoke-goals.mjs
 */

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.OPENX_API_BASE ?? process.env.OPENX_BASE_URL ?? "http://127.0.0.1:3921";
const POLL_MS = 2_000;
const SMOKE_TIMEOUT_MS = Number(process.env.MILOCO_SMOKE_TIMEOUT_MS ?? 180_000);

let failed = 0;

function ok(msg) {
  console.log(`✓ ${msg}`);
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  failed += 1;
}

function warn(msg) {
  console.warn(`! ${msg}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function get(path, headers = {}) {
  const res = await fetch(`${BASE}${path}`, { headers });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data, text };
}

async function post(path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
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
    title: `Miloco smoke ${new Date().toISOString().slice(0, 16)}`,
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

  const wslStatus = runWslMiloco(["service", "status"]);
  if (wslStatus.ok) ok("WSL miloco-cli service status");
  else {
    const ver = runWslMiloco(["--version"]);
    if (ver.ok) ok("WSL miloco-cli --version");
    else fail(`WSL miloco-cli unavailable: ${wslStatus.stderr || wslStatus.stdout}`);
  }
}

async function stepNotifyPush() {
  console.log("\n--- Step A: notify push ---\n");

  const result = runWslMiloco(["notify", "push", "--text", "OpenX 联调 smoke"]);
  if (result.ok) {
    ok("miloco-cli notify push succeeded");
    if (result.stdout) warn(`stdout: ${result.stdout.slice(0, 200)}`);
  } else {
    fail(`notify push failed (exit ${result.status}): ${result.stderr || result.stdout}`);
  }
}

async function stepDeviceListGoal(conversationId) {
  console.log("\n--- Step B/C: device list Goal ---\n");

  const goalPayload = {
    conversationId,
    userDraft: "列出当前家庭所有设备，标注 online/offline，重点说明路由器与循环扇",
    title: "Miloco smoke：查询米家设备列表",
    acceptance:
      "返回设备列表摘要（房间、名称、在线状态），并重点标注路由器与循环扇的 did 与 online/offline 状态",
    executionPrompt: [
      "加载 miloco-devices 与 miloco-miot-scope skill。",
      "通过 scripts/miloco-wsl.ps1 执行 device list，按房间整理结果。",
      "重点汇报路由器与循环扇的 did、名称与 online/offline 状态。",
      "不要控制任何设备。",
    ].join("\n"),
    executorId: "pi",
    autoStart: true,
    autoReview: false,
    refinedMessageId: 1,
    dispatchContext: {
      skillIds: [
        "miloco-devices",
        "miloco-miot-scope",
        "miloco-miot-admin",
        "miloco-notify",
        "miloco-perception",
      ],
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
    else warn("Goal logs missing [pi] marker");

    if (/miloco-wsl|device list/i.test(combined)) {
      ok("Goal output suggests miloco-cli device list execution");
    } else {
      warn("Goal output does not show device list execution (Pi may have summarized only)");
    }

    if (/online|offline|993802700|miwifi/i.test(combined)) {
      ok("Goal output mentions device online status or known did");
    } else {
      warn("Goal output missing online/offline or known device did");
    }
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

async function main() {
  console.log(`Miloco smoke goals — ${BASE}`);
  console.log(`Poll timeout: ${SMOKE_TIMEOUT_MS}ms`);

  await preflight();
  if (failed > 0) {
    console.error(`\n${failed} preflight failure(s) — aborting smoke test.`);
    process.exit(1);
  }

  await stepNotifyPush();
  if (failed > 0) {
    console.error(`\n${failed} failure(s) after notify step.`);
    process.exit(1);
  }

  const conversationId = await ensureConversationId();
  ok(`Using conversation ${conversationId}`);
  await stepDeviceListGoal(conversationId);

  if (failed === 0) {
    console.log("\n全部 smoke 通过。");
  } else {
    console.error(`\n${failed} 项失败。`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
