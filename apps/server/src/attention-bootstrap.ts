import { islandForAwaitingReview, islandForFailed } from "@openx/shared";
import { listGoals } from "./db.js";
import { getAttentionByKey, upsertOpenAttention } from "./attention-store.js";

/** 从 Goal 状态补齐 / 重开 attention（刷新/重连恢复） */
export function ensureAttentionsFromGoals(): void {
  for (const goal of listGoals("awaiting_review")) {
    const key = `goal.awaiting_review:${goal.id}`;
    const existing = getAttentionByKey(key);
    // 仍待验收则保持或重开 open（ack 后刷新仍应出现）
    if (existing?.state === "open") continue;
    upsertOpenAttention(islandForAwaitingReview(goal));
  }
  for (const goal of listGoals("failed")) {
    const key = `goal.failed:${goal.id}`;
    if (getAttentionByKey(key)?.state === "open") continue;
    upsertOpenAttention(islandForFailed(goal));
  }
}
