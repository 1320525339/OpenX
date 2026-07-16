#!/usr/bin/env node
/**
 * Miloco × OpenX Layer A live E2E (real Pi, not mock).
 *
 * Prerequisites:
 *   - OpenX server running WITHOUT OPENX_MOCK_PI=1
 *   - Pi LLM configured (providers / OPENX_LLM_*)
 *   - WSL Miloco installed: scripts/wsl-install-miloco.ps1
 *   - pnpm miloco:setup && pnpm miloco:connect
 *
 * Usage:
 *   node scripts/e2e-miloco-live.mjs
 *   OPENX_E2E_TIMEOUT_MS=300000 node scripts/e2e-miloco-live.mjs
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.OPENX_API_BASE ?? "http://127.0.0.1:3921";
const POLL_MS = 2_000;
const LIVE_TIMEOUT_MS = Number(process.env.OPENX_E2E_TIMEOUT_MS ?? 300_000);
const WEBHOOK_TIMEOUT_MS = Number(process.env.OPENX_MILOCO_WEBHOOK_TIMEOUT_MS ?? 300_000);
const MILOCO_EVENTS_CONVERSATION_ID = "openx-miloco-events";

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

function readWebhookToken() {
  const tokenPath = join(homedir(), ".openx", "miloco-webhook.token");
  if (!existsSync(tokenPath)) return null;
  return readFileSync(tokenPath, "utf8").trim() || null;
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

function runWslBash(command) {
  const distro = process.env.OPENX_MILOCO_WSL_DISTRO ?? "Ubuntu";
  const result = spawnSync("wsl", ["-d", distro, "bash", "-lc", command], {
    encoding: "utf8",
    cwd: ROOT,
  });
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

function curlWebhookFromWsl(host, port, token) {
  const url = `http://${host}:${port}/api/miloco/webhook`;
  return runWslBash(
    `curl -sf --connect-timeout 5 --max-time 10 -H 'Authorization: Bearer ${token}' '${url}'`,
  );
}

function detectWslWindowsHost() {
  const route = runWslBash("ip route show default 2>/dev/null | cut -d' ' -f3 | head -1");
  const ip = route.stdout.split(/\s+/)[0]?.trim();
  if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip;
  return null;
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
      if (pi.hint) warn(`Pi hint: ${pi.hint}`);
    } else {
      fail("Pi executor not available");
    }
  } else {
    fail(`GET /api/executors: ${executors.status}`);
  }

  const status = await get("/api/miloco/status");
  if (status.status === 200) {
    if (status.data.webhook?.tokenConfigured) ok("Webhook token configured");
    else fail("Webhook token not configured — run pnpm miloco:setup");
    const bound = status.data.skillsBoundToPi ?? [];
    if (bound.length >= 5) ok(`Skills bound to pi: ${bound.join(", ")}`);
    else fail(`Expected >=5 skills bound, got ${bound.length}`);
  } else {
    fail(`GET /api/miloco/status: ${status.status}`);
  }

  const wslStatus = runWslMiloco(["service", "status"]);
  if (wslStatus.ok) ok("WSL miloco-cli service status");
  else {
    const ver = runWslMiloco(["--version"]);
    if (ver.ok) ok("WSL miloco-cli --version");
    else fail(`WSL miloco-cli unavailable: ${wslStatus.stderr || wslStatus.stdout}`);
  }

  const token = readWebhookToken();
  if (!token) {
    fail("Missing ~/.openx/miloco-webhook.token");
    return null;
  }
  ok("Webhook token file present");

  const host = new URL(BASE).hostname;
  const port = new URL(BASE).port || "3921";
  let curl = curlWebhookFromWsl(host, port, token);
  if (!curl.ok && host === "127.0.0.1") {
    const gw = detectWslWindowsHost();
    if (gw) {
      warn(`127.0.0.1 unreachable from WSL, retry via gateway ${gw}`);
      curl = curlWebhookFromWsl(gw, port, token);
      if (curl.ok) {
        warn(`Use miloco-connect-wsl.ps1 -WebhookHost ${gw} for Miloco backend`);
      }
    }
  }
  if (curl.ok) ok(`WSL → OpenX webhook`);
  else warn(`WSL cannot curl OpenX webhook (Layer B only; Layer A runs from Windows)`);

  return token;
}

async function waitForGoalStatus(goalId, statuses, timeoutMs = LIVE_TIMEOUT_MS) {
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

async function runLiveWebhook(token) {
  console.log("\n--- Live webhook turn ---\n");

  const traceId = `live-e2e-${Date.now()}`;
  const message = [
    "[感知引擎]事件提醒：",
    "来源：E2E测试",
    "检测到：联调探针",
    "建议：仅执行 miloco-cli service status 与 device list，汇报结果，不要控制任何设备",
  ].join("\n");

  const turn = await post(
    "/api/miloco/webhook",
    {
      action: "agent",
      payload: {
        message,
        sessionKey: "agent:main:miloco-suggest",
        lane: "miloco-suggest",
        traceId,
        idempotencyKey: traceId,
        timeoutMs: WEBHOOK_TIMEOUT_MS,
      },
    },
    { authorization: `Bearer ${token}` },
  );

  if (turn.status !== 200 || turn.data.code !== 0 || !turn.data.data?.runId) {
    fail(`Webhook turn failed: ${turn.status} ${turn.text}`);
    return;
  }

  const { runId, status: turnStatus } = turn.data.data;
  ok(`Webhook returned runId=${runId} status=${turnStatus}`);

  if (turnStatus === "ok") {
    ok("Webhook sync status=ok");
  } else if (turnStatus === "timeout") {
    warn("Webhook sync status=timeout — will poll goal independently");
  } else {
    fail(`Webhook sync status=${turnStatus}: ${turn.data.data.error ?? ""}`);
    return;
  }

  let goal;
  let logs;
  try {
    ({ goal, logs } = await waitForGoalStatus(runId, ["awaiting_review", "done", "failed"]));
    if (goal.status === "awaiting_review" || goal.status === "done") {
      ok(`Goal reached ${goal.status}`);
    } else {
      fail(`Goal failed: ${goal.status}`);
    }
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
    return;
  }

  const pool = await get(`/api/goals?conversationId=${MILOCO_EVENTS_CONVERSATION_ID}`);
  if (pool.status === 200 && pool.data.goals?.some((g) => g.id === runId)) {
    ok(`Goal listed in conversation ${MILOCO_EVENTS_CONVERSATION_ID}`);
  } else {
    fail("Goal not found in miloco-events conversation");
  }

  const logText = logs.map((l) => l.message ?? "").join("\n");
  if (logText.includes("[pi]")) ok("Goal logs contain [pi]");
  else warn("Goal logs missing [pi] marker");

  if (/miloco-wsl|service status|device list/i.test(logText)) {
    ok("Goal logs suggest miloco-cli execution");
  } else {
    warn("Goal logs do not show miloco-wsl/service status (Pi may have summarized only)");
  }

  const trace = await post(
    "/api/miloco/webhook",
    { action: "get_trace", payload: { runId } },
    { authorization: `Bearer ${token}` },
  );
  if (trace.status === 200 && trace.data.code === 0 && trace.data.data?.status === "done") {
    ok("get_trace → done");
  } else {
    fail(`get_trace failed: ${trace.text}`);
  }
}

async function main() {
  console.log(`Miloco live E2E — ${BASE}`);
  console.log(`Poll timeout: ${LIVE_TIMEOUT_MS}ms, webhook timeout: ${WEBHOOK_TIMEOUT_MS}ms`);

  const token = await preflight();
  if (!token) {
    console.error("\nPreflight failed — fix issues before live turn.");
    process.exit(1);
  }

  if (failed > 0) {
    console.error(`\n${failed} preflight failure(s) — aborting live turn.`);
    process.exit(1);
  }

  await runLiveWebhook(token);

  if (failed === 0) {
    console.log("\n全部 live E2E 通过。");
  } else {
    console.error(`\n${failed} 项失败。`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
