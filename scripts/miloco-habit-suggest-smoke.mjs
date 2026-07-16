#!/usr/bin/env node
/**
 * Habit suggest state machine API smoke (no real notify).
 */

import { unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const BASE = process.env.OPENX_API_BASE ?? process.env.OPENX_BASE_URL ?? "http://127.0.0.1:3921";

async function post(body) {
  const res = await fetch(`${BASE}/api/miloco/habit-suggest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function main() {
  console.log(`Miloco habit-suggest smoke — ${BASE}`);

  // 清空状态，避免与当日 cron/联调数据冲突
  try {
    unlinkSync(join(homedir(), ".openx", "miloco-habit-suggest.json"));
  } catch {
    /* fresh */
  }

  const key = `smoke_test_${Date.now()}`;

  const list0 = await post({ action: "list" });
  if (!list0.ok) throw new Error("list failed");
  console.log("✓ list");

  const rec = await post({
    action: "record",
    key,
    subject: "shared",
    habit: "傍晚健身",
    suggestion: "健身时自动放运动歌单",
    title: "健身歌单",
  });
  if (!rec.ok) throw new Error("record failed");
  console.log("✓ record");

  const mark = await post({ action: "mark_asked", key });
  if (!mark.ok) throw new Error(`mark_asked: ${JSON.stringify(mark)}`);
  console.log("✓ mark_asked");

  const rej = await post({
    action: "resolve",
    key,
    outcome: "rejected",
  });
  if (!rej.ok) throw new Error("resolve rejected failed");
  console.log("✓ resolve rejected");

  const rec2 = await post({
    action: "record",
    key,
    subject: "shared",
    habit: "傍晚健身",
    suggestion: "健身时自动放运动歌单",
  });
  if (!rec2.deduped || rec2.status !== "rejected") {
    throw new Error("expected permanent dedup after reject");
  }
  console.log("✓ permanent dedup after reject");
  console.log("\nAll habit-suggest API checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
