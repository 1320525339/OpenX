#!/usr/bin/env node
/**
 * Batch3 cron smoke: trigger perception-digest + poll openx-miloco-cron Goal.
 * Use OPENX_MOCK_PI=1 for CI without real Pi.
 */

const BASE = process.env.OPENX_API_BASE ?? process.env.OPENX_BASE_URL ?? "http://127.0.0.1:3921";
const POLL_MS = 2_000;
const TIMEOUT_MS = Number(process.env.MILOCO_BATCH3_CRON_SMOKE_TIMEOUT_MS ?? 120_000);
const CRON_CONVERSATION = "openx-miloco-cron";

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  const text = await res.text();
  return { status: res.status, data: JSON.parse(text), text };
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  return { status: res.status, data: JSON.parse(text), text };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(`Miloco batch3 cron smoke — ${BASE}`);

  const before = await get(`/api/goals?conversationId=${encodeURIComponent(CRON_CONVERSATION)}`);
  const known = new Set((before.data.goals ?? []).map((g) => g.id));

  const trigger = await post("/api/miloco/home-cron/trigger", {
    name: "miloco-perception-digest",
  });
  if (trigger.status !== 200 || !trigger.data.ok) {
    console.error("trigger failed", trigger.text);
    process.exit(1);
  }
  console.log(`✓ triggered goal ${trigger.data.goalId}`);

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await get(`/api/goals?conversationId=${encodeURIComponent(CRON_CONVERSATION)}`);
    const fresh = (res.data.goals ?? []).filter((g) => !known.has(g.id));
    if (fresh.length > 0) {
      const g = fresh[0];
      console.log(`✓ cron goal appeared: ${g.id} (${g.status})`);
      if (process.env.OPENX_MOCK_PI === "1") {
        console.log("(Mock Pi — skip terminal status wait)");
        process.exit(0);
      }
      while (Date.now() < deadline) {
        const detail = await get(`/api/goals/${g.id}`);
        const goal = detail.data.goal;
        if (["awaiting_review", "done", "failed"].includes(goal.status)) {
          if (goal.status === "failed") {
            console.error("Goal failed");
            process.exit(1);
          }
          console.log(`✓ Goal terminal: ${goal.status}`);
          process.exit(0);
        }
        await sleep(POLL_MS);
      }
    }
    await sleep(POLL_MS);
  }
  console.error("timeout waiting for cron goal");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
