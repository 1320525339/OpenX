import type { Goal } from "@openx/shared";
import { GOAL_STATUS_LABELS } from "@openx/shared";

const PRIORITY_LABELS: Record<Goal["priority"], string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "紧急",
};

export function goalStatusText(goal: Goal): string {
  if (goal.effectStatus === "rework") return "需要返工";
  if (goal.status === "running") return "正在推进";
  if (goal.status === "awaiting_review") return "等你确认";
  return GOAL_STATUS_LABELS[goal.status] ?? goal.status;
}

export function buildGoalContext(allGoals: Goal[], goal: Goal) {
  const byId = new Map(allGoals.map((g) => [g.id, g]));
  const parent = goal.parentGoalId ? byId.get(goal.parentGoalId) : undefined;
  const children = allGoals.filter((g) => g.parentGoalId === goal.id);
  const dependencies = goal.dependsOn
    .map((id) => byId.get(id))
    .filter((g): g is Goal => Boolean(g));
  return { parent, children, dependencies };
}

export function truncate(text: string, max = 320): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export { PRIORITY_LABELS };
