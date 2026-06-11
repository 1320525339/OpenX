import type { Goal } from "@openx/shared";
import { GOAL_STATUS_LABELS } from "@openx/shared";

const PRIORITY_LABELS: Record<Goal["priority"], string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "紧急",
};

export function goalStatusText(goal: Goal): string {
  if (goal.effectStatus === "rework" && goal.status !== "done") return "需要返工";
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

const PERSONA_LABELS: Record<string, string> = {
  coach: "工头助手",
  coder: "编码助手",
  reviewer: "审查员",
};

export function formatDispatchSummary(goal: Goal): string | null {
  const dc = goal.dispatchContext;
  if (!dc) return null;
  const parts: string[] = [];
  if (dc.agentId) {
    parts.push(`Persona: ${PERSONA_LABELS[dc.agentId] ?? dc.agentId}`);
  }
  if (dc.mcpIds?.length) parts.push(`MCP: ${dc.mcpIds.join(", ")}`);
  if (dc.skillIds?.length) parts.push(`Skills: ${dc.skillIds.join(", ")}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export { PRIORITY_LABELS };
