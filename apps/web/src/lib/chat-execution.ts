import type { Goal, GoalRunState } from "@openx/shared";
import { createEmptyRunState } from "@openx/shared";

/** 当前对话中优先展示的执行中任务（选中项优先） */
export function pickConversationExecution(
  goals: Goal[],
  runs: Record<string, GoalRunState>,
  selectedGoal?: Goal,
): { goal: Goal; run: GoalRunState } | null {
  const ordered: Goal[] = [];
  if (
    selectedGoal &&
    (selectedGoal.status === "running" || selectedGoal.status === "awaiting_review")
  ) {
    ordered.push(selectedGoal);
  }
  for (const g of goals) {
    if (g.status === "running" && g.id !== selectedGoal?.id) ordered.push(g);
  }
  for (const g of goals) {
    if (g.status === "awaiting_review" && g.id !== selectedGoal?.id) ordered.push(g);
  }

  for (const goal of ordered) {
    const run = runs[goal.id] ?? createEmptyRunState(goal.id);
    if (run.active || run.events.length > 0 || run.liveText) {
      return { goal, run };
    }
  }
  return null;
}
