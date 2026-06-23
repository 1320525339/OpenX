import type { Goal } from "@openx/shared";
import { goalMatchesDisplayFilter } from "@openx/shared";

export const PIN_DESK_FILTERS: { key: string; label: string }[] = [
  { key: "running", label: "进行中" },
  { key: "awaiting_review", label: "待验收" },
  { key: "done", label: "已完成" },
  { key: "failed", label: "异常" },
];

export type PinDeskSort = "default" | "updated" | "orderNo";

export function countPinDeskFilter(goals: Goal[], key: string): number {
  if (key === "failed") {
    return goals.filter((g) => g.status === "failed" || g.status === "cancelled").length;
  }
  return goals.filter((g) => goalMatchesDisplayFilter(g, key)).length;
}

export function matchesPinDeskSearch(goal: Goal, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const wo = goal.orderNo > 0 ? `wo-${String(goal.orderNo).padStart(6, "0")}` : "";
  const hay = `${goal.title} ${wo} ${goal.id}`.toLowerCase();
  return hay.includes(q);
}

export function sortPinDeskGoals(goals: Goal[], sort: PinDeskSort): Goal[] {
  const copy = [...goals];
  if (sort === "updated") {
    copy.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return copy;
  }
  if (sort === "orderNo") {
    copy.sort((a, b) => b.orderNo - a.orderNo);
    return copy;
  }
  copy.sort((a, b) => {
    if (a.orderNo !== b.orderNo) return b.orderNo - a.orderNo;
    return a.createdAt.localeCompare(b.createdAt);
  });
  return copy;
}

export function formatGoalSourceLabel(
  goal: Goal,
  conversationTitles?: Record<string, string>,
): string {
  const conv = conversationTitles?.[goal.conversationId];
  if (conv) return conv;
  return goal.conversationId ? `对话 ${goal.conversationId.slice(0, 6)}` : "—";
}

export function formatGoalDurationShort(goal: Goal): string {
  const ms = new Date(goal.updatedAt).getTime() - new Date(goal.createdAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const mins = Math.max(1, Math.round(ms / 60_000));
  if (mins < 60) return `${mins} 分钟`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`;
}
