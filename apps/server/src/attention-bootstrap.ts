import { islandForAwaitingReview, islandForFailed } from "@openx/shared";
import { listGoals } from "./db.js";
import { getAttentionByKey, upsertOpenAttention } from "./attention-store.js";

/**
 * 从 Goal 状态补齐缺失的 attention（崩溃恢复 / 旧数据）。
 * 不重开已 acknowledged / resolved 的记录——「知道了」须保持有效；
 * 真正再次需要提醒时由 pushIsland → upsertOpenAttention 显式重开。
 */
export function ensureAttentionsFromGoals(): void {
  for (const goal of listGoals("awaiting_review")) {
    const key = `goal.awaiting_review:${goal.id}`;
    if (getAttentionByKey(key)) continue;
    upsertOpenAttention(islandForAwaitingReview(goal));
  }
  for (const goal of listGoals("failed")) {
    const key = `goal.failed:${goal.id}`;
    if (getAttentionByKey(key)) continue;
    upsertOpenAttention(islandForFailed(goal));
  }
}
