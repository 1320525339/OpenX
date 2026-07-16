#!/usr/bin/env node
/**
 * WSL → OpenX webhook path smoke (same network path Miloco dispatcher uses).
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const BASE = process.env.OPENX_API_BASE ?? process.env.OPENX_BASE_URL ?? "http://127.0.0.1:3921";
const DISTRO = process.env.OPENX_MILOCO_WSL_DISTRO ?? "Ubuntu";

function readWebhookToken() {
  const path = join(homedir(), ".openx", "miloco-webhook.token");
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8").trim();
}

function detectGateway() {
  const r = spawnSync(
    "wsl",
    ["-d", DISTRO, "bash", "-lc", "ip route show default 2>/dev/null | awk '{print $3; exit}'"],
    { encoding: "utf8" },
  );
  return (r.stdout ?? "").match(/\d+\.\d+\.\d+\.\d+/)?.[0] ?? "127.0.0.1";
}

async function main() {
  console.log(`Miloco interactive WSL path smoke — ${BASE}\n`);

  const token = readWebhookToken();
  if (!token) throw new Error("缺少 ~/.openx/miloco-webhook.token");

  const gw = detectGateway();
  const webhookHost = new URL(BASE).hostname === "127.0.0.1" ? gw : new URL(BASE).hostname;
  const webhookPort = new URL(BASE).port || "3921";
  const webhookUrl = `http://${webhookHost}:${webhookPort}/api/miloco/webhook`;

  const health = spawnSync(
    "wsl",
    ["-d", DISTRO, "bash", "-lc", `curl -sS -o /dev/null -w '%{http_code}' '${webhookUrl}' 2>/dev/null || true`],
    { encoding: "utf8" },
  );
  const healthCode = (health.stdout ?? "").match(/\d{3}/)?.[0];
  if (healthCode !== "200") {
    throw new Error(`WSL 无法访问 webhook ${webhookUrl}（http=${healthCode ?? "none"}）`);
  }
  console.log(`✓ WSL 可达 ${webhookUrl}`);

  const traceId = `wsl-interactive-${Date.now()}`;
  const message = [
    "[感知引擎]语音提醒：",
    "来源：客厅的小米C700",
    "说话人：用户",
    "语音指令：打开客厅灯",
  ].join("\n");

  const body = JSON.stringify({
    action: "agent",
    payload: {
      message,
      sessionKey: "agent:main:miloco",
      lane: "miloco-interactive",
      traceId,
      idempotencyKey: traceId,
      timeoutMs: Number(process.env.OPENX_E2E_TIMEOUT_MS ?? 120_000),
    },
  });
  const escaped = body.replace(/'/g, "'\\''");

  const curl = spawnSync(
    "wsl",
    [
      "-d",
      DISTRO,
      "bash",
      "-lc",
      `curl -sS -X POST '${webhookUrl}' -H 'Authorization: Bearer ${token}' -H 'Content-Type: application/json' -d '${escaped}' 2>/dev/null`,
    ],
    { encoding: "utf8" },
  );

  const bodyStart = (curl.stdout ?? "").indexOf("{");
  if (bodyStart < 0) throw new Error(`WSL webhook POST 无 JSON 响应: ${curl.stdout}`);
  const data = JSON.parse(curl.stdout.slice(bodyStart));
  if (data.code !== 0) throw new Error(`webhook 失败: ${JSON.stringify(data)}`);

  console.log(`✓ WSL POST webhook: runId=${data.data?.runId} status=${data.data?.status}`);
  if (data.data?.status !== "ok") {
    throw new Error("turn status 非 ok（真机可设 OPENX_MOCK_PI=1）");
  }

  const events = await fetch(`${BASE}/api/miloco/events?lane=miloco-interactive&limit=3`).then((r) =>
    r.json(),
  );
  if (!(events.goals ?? []).some((g) => g.id === data.data.runId)) {
    throw new Error("events API 未找到 WSL 触发的 Goal");
  }
  console.log("✓ Goal 出现在 miloco-interactive 事件流");

  console.log("\nAll WSL → OpenX interactive path checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
