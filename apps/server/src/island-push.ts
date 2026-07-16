import type { DynamicIslandPayload, Goal } from "@openx/shared";
import {
  islandForAwaitingReview,
  islandForFailed,
  islandForGateBlocked,
  islandForReviewBlocked,
  islandForReviewLimit,
  islandForReviewUnavailable,
  isDurableIslandKind,
} from "@openx/shared";
import { upsertOpenAttention } from "./attention-store.js";
import { broadcast } from "./sse.js";

export {
  islandForAwaitingReview,
  islandForFailed,
  islandForGateBlocked,
  islandForReviewBlocked,
  islandForReviewLimit,
  islandForReviewUnavailable,
};

/** 推送灵动岛；durable 同步写入 AttentionRecord */
export function pushIsland(payload: DynamicIslandPayload): void {
  if (isDurableIslandKind(payload.kind)) {
    upsertOpenAttention(payload);
  }
  broadcast({ type: "island.push", payload });
}

export function pushAwaitingReviewIsland(goal: Goal): void {
  pushIsland(islandForAwaitingReview(goal));
}

export function pushFailedIsland(goal: Goal, message?: string): void {
  pushIsland(islandForFailed(goal, message));
}
