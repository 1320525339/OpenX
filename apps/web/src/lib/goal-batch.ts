import type { BatchGoalsAction, Goal } from "@openx/shared";
import { GOAL_STATUS_LABELS } from "@openx/shared";

export function selectedGoals(all: Goal[], ids: Set<string>): Goal[] {
  return all.filter((g) => ids.has(g.id));
}

export function goalsEligibleForAction(goals: Goal[], action: BatchGoalsAction): Goal[] {
  switch (action) {
    case "start":
      return goals.filter((g) => g.status === "draft" || g.status === "failed");
    case "cancel":
      return goals.filter((g) => g.status === "running" || g.status === "paused");
    case "approve":
      return goals.filter((g) => g.status === "awaiting_review");
    case "delete":
      return goals;
  }
}

export function statusBreakdown(goals: Goal[]): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const g of goals) {
    const label = GOAL_STATUS_LABELS[g.status] ?? g.status;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count }));
}
