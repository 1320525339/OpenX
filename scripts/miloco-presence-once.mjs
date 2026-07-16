#!/usr/bin/env node
/**
 * One-shot Miloco device presence poll via OpenX API.
 *
 * Usage:
 *   node scripts/miloco-presence-once.mjs
 *   OPENX_BASE_URL=http://127.0.0.1:3921 node scripts/miloco-presence-once.mjs
 */

const BASE = process.env.OPENX_API_BASE ?? process.env.OPENX_BASE_URL ?? "http://127.0.0.1:3921";

async function main() {
  const statusRes = await fetch(`${BASE}/api/miloco/presence`);
  if (statusRes.ok) {
    const status = await statusRes.json();
    console.log("Presence status:", JSON.stringify(status, null, 2));
  }

  const pollRes = await fetch(`${BASE}/api/miloco/presence/poll`, { method: "POST" });
  const text = await pollRes.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!pollRes.ok) {
    console.error(`Poll failed: ${pollRes.status} ${text}`);
    process.exit(1);
  }

  console.log("\nPoll result:", JSON.stringify(data, null, 2));

  if (data.error) {
    console.error(`\nError: ${data.error}`);
    process.exit(1);
  }

  if (data.changes?.length) {
    console.log(`\n${data.changes.length} change(s) detected; agent turn triggered=${data.triggered}`);
  } else if (!data.baselineReady) {
    console.log("\nBaseline recorded (first poll, no notifications).");
  } else {
    console.log("\nNo changes since last poll.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
