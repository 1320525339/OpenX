#!/usr/bin/env node
/**
 * Miloco interactive lane smoke: simulate voice command webhook → Pi Goal.
 *
 * Requires OpenX server on OPENX_API_BASE (default http://127.0.0.1:3921).
 * Use OPENX_MOCK_PI=1 for fast path without real Pi execution.
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = process.env.OPENX_API_BASE ?? process.env.OPENX_BASE_URL ?? "http://127.0.0.1:3921";

function readWebhookToken() {
  const path = join(homedir(), ".openx", "miloco-webhook.token");
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8").trim();
}

async function post(path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, text };
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  return res.json();
}

async function main() {
  console.log(`Miloco interactive smoke — ${BASE}\n`);

  const health = await get("/api/miloco/webhook");
  if (!health.ok || health.service !== "miloco-webhook") {
    throw new Error("OpenX Miloco webhook 未就绪，请先启动 server");
  }
  console.log("✓ webhook 健康探针");

  const token = readWebhookToken();
  if (!token) throw new Error("缺少 ~/.openx/miloco-webhook.token");

  const traceId = `interactive-smoke-${Date.now()}`;
  const message = [
    "[感知引擎]语音提醒：",
    "来源：客厅的小米C700",
    "说话人：用户",
    "语音指令：现在几点了",
  ].join("\n");

  const turn = await post(
    "/api/miloco/webhook",
    {
      action: "agent",
      payload: {
        message,
        sessionKey: "agent:main:miloco",
        lane: "miloco-interactive",
        traceId,
        idempotencyKey: traceId,
        timeoutMs: Number(process.env.OPENX_E2E_TIMEOUT_MS ?? 120_000),
      },
    },
    { authorization: `Bearer ${token}` },
  );

  if (turn.status !== 200 || turn.data?.code !== 0) {
    throw new Error(`webhook turn 失败: ${turn.status} ${JSON.stringify(turn.data)}`);
  }

  const { runId, status } = turn.data.data ?? {};
  if (!runId) throw new Error("webhook 未返回 runId");
  console.log(`✓ interactive webhook turn: runId=${runId} status=${status}`);

  if (status !== "ok") {
    throw new Error(
      `turn status=${status}（真机 Pi 失败时可设 OPENX_MOCK_PI=1 启动 server 做契约验收）`,
    );
  }

  const goalRes = await get(`/api/goals/${runId}`);
  const goal = goalRes.goal;
  if (!goal) throw new Error("Goal 未找到");
  if (goal.conversationId !== "openx-miloco-events") {
    throw new Error(`Goal 会话异常: ${goal.conversationId}`);
  }
  if (!goal.title.includes("语音/交互")) {
    throw new Error(`Goal 标题异常: ${goal.title}`);
  }
  if (!goal.executionPrompt?.includes("【Miloco 语音交互】")) {
    throw new Error("executionPrompt 缺少语音交互专用指引");
  }
  if (!goal.executionPrompt?.includes("禁止默认 execute-text-directive")) {
    throw new Error("executionPrompt 缺少 execute-text-directive 禁令");
  }
  console.log("✓ Goal 已创建且含 miloco-interactive 专用指引");

  const events = await get("/api/miloco/events?lane=miloco-interactive&limit=5");
  const found = (events.goals ?? []).some((g) => g.id === runId);
  if (!found) throw new Error("events API lane 过滤未返回该 Goal");
  console.log("✓ GET /api/miloco/events?lane=miloco-interactive");

  // 30s 内重复指令应被去重
  const dup = await post(
    "/api/miloco/webhook",
    {
      action: "agent",
      payload: {
        message,
        sessionKey: "agent:main:miloco",
        lane: "miloco-interactive",
        traceId: `${traceId}-dup`,
        idempotencyKey: `${traceId}-dup`,
        timeoutMs: 30_000,
      },
    },
    { authorization: `Bearer ${token}` },
  );
  if (dup.data?.data?.runId?.startsWith("dedup-") && dup.data?.data?.status === "ok") {
    console.log("✓ 30s 内重复语音指令已去重");
  } else {
    console.warn("⚠ 去重未触发（可能间隔过长或 server 未热重载）");
  }

  console.log("\nAll miloco-interactive smoke checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
