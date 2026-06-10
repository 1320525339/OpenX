import type { Goal, RefinedGoal, RefinedSubGoal } from "@openx/shared";
import { EXECUTOR_AUTO } from "@openx/shared";

export function resolveNorthStar(goals: Goal[], goalId: string): Goal | undefined {
  const byId = new Map(goals.map((g) => [g.id, g]));
  let current = byId.get(goalId);
  if (!current) return undefined;
  while (current.parentGoalId) {
    const parent = byId.get(current.parentGoalId);
    if (!parent) break;
    current = parent;
  }
  return current;
}

export function mapRefinedSubGoals(subGoals: RefinedSubGoal[], defaultExecutorId = "pi") {
  const fallback = defaultExecutorId === EXECUTOR_AUTO ? "pi" : defaultExecutorId;
  return subGoals.map((sg) => ({
    userDraft: sg.executionPrompt,
    title: sg.title,
    acceptance: sg.acceptance,
    executionPrompt: sg.executionPrompt,
    constraints: sg.constraints,
    executorId: sg.executorId ?? fallback,
    priority: sg.priority,
  }));
}

export type RefinedPreviewState = RefinedGoal;
