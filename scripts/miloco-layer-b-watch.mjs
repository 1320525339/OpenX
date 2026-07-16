#!/usr/bin/env node
/**
 * Layer B watch: poll openx-miloco-events for new Goals after manual perception trigger.
 *
 * Usage:
 *   node scripts/miloco-layer-b-watch.mjs
 *   MILOCO_LAYER_B_WATCH_MS=300000 node scripts/miloco-layer-b-watch.mjs
 */

const MILOCO_EVENTS_CONVERSATION_ID = "openx-miloco-events";
const BASE = process.env.OPENX_API_BASE ?? process.env.OPENX_BASE_URL ?? "http://127.0.0.1:3921";
const TERMINAL = new Set(["awaiting_review", "done", "failed", "cancelled"]);
const POLL_MS = 5_000;
const TIMEOUT_MS = Number(process.env.MILOCO_LAYER_B_WATCH_MS ?? 300_000);

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${text}`);
  return JSON.parse(text);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(`Layer B watch — ${BASE}`);
  console.log(`Conversation: ${MILOCO_EVENTS_CONVERSATION_ID}`);
  console.log(`Timeout: ${TIMEOUT_MS}ms · 请对摄像头说话或等待感知事件\n`);

  const layerB = await get("/api/miloco/layer-b");
  console.log("Layer B ready:", layerB.ready);
  for (const c of layerB.checks ?? []) {
    console.log(`  ${c.ok ? "✓" : "✗"} ${c.id}: ${c.detail}`);
  }
  if (!layerB.ready) {
    console.warn("\nLayer B 未就绪，仍继续监听（可能先有 Goal 再修复摄像头）。");
  }

  const initial = await get(
    `/api/goals?conversationId=${encodeURIComponent(MILOCO_EVENTS_CONVERSATION_ID)}`,
  );
  const known = new Set((initial.goals ?? []).map((g) => g.id));
  console.log(`\nBaseline: ${known.size} goal(s). Waiting for new goals…`);

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await get(
      `/api/goals?conversationId=${encodeURIComponent(MILOCO_EVENTS_CONVERSATION_ID)}`,
    );
    const goals = res.goals ?? [];
    const fresh = goals.filter((g) => !known.has(g.id));
    if (fresh.length > 0) {
      for (const g of fresh) {
        console.log(`\n✓ 新 Goal: ${g.id}`);
        console.log(`  标题: ${g.title}`);
        console.log(`  状态: ${g.status}`);
        console.log(`  会话: ${g.conversationId ?? "(unknown)"}`);
        known.add(g.id);
        if (g.conversationId !== MILOCO_EVENTS_CONVERSATION_ID) {
          console.warn(`  ⚠ 期望会话 ${MILOCO_EVENTS_CONVERSATION_ID}`);
        }
      }
      const target = fresh.find((g) => g.conversationId === MILOCO_EVENTS_CONVERSATION_ID) ?? fresh[0];
      const deadlineGoal = Date.now() + TIMEOUT_MS;
      while (Date.now() < deadlineGoal) {
        const detail = await get(`/api/goals/${encodeURIComponent(target.id)}`);
        const goal = detail.goal ?? detail;
        if (TERMINAL.has(goal.status)) {
          if (goal.status === "awaiting_review" || goal.status === "done") {
            console.log(`\n✓ Goal 终态: ${goal.status}`);
            process.exit(0);
          }
          console.error(`\n✗ Goal 终态异常: ${goal.status}`);
          process.exit(1);
        }
        await sleep(POLL_MS);
      }
      console.error("\n超时：Goal 已出现但未到达 awaiting_review/done");
      process.exit(1);
    }
    await sleep(POLL_MS);
  }

  console.error(`\n超时 ${TIMEOUT_MS}ms：未检测到新 Goal。`);
  console.error("请确认摄像头就绪、WSL webhook 可达，并对摄像头说话或等待规则触发。");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
