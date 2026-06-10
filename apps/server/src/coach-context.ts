import { formatFeedbackNotes } from "@openx/coach";
import {
  ACP_RUNTIMES,
  GOAL_STATUS_LABELS,
  type CoachChatContext,
  type CoachGoalBrief,
  type Goal,
} from "@openx/shared";
import {
  buildGoalFeedback,
  getGoalById,
  listChildGoals,
  listGoals,
} from "./db.js";
import { loadSettings } from "./settings-store.js";
import { listConnections } from "./connect-store.js";
import { resolveWorkspaceRoot } from "./workspace-path.js";
import { buildExecutorSkillsMap } from "./executor-recommend-service.js";

function buildExecutorsList(): string[] {
  const executors = new Set<string>(["pi"]);
  for (const id of Object.keys(ACP_RUNTIMES)) {
    executors.add(id);
  }
  for (const conn of listConnections()) {
    executors.add(`connect:${conn.agentName} (${conn.executorId})`);
  }
  return [...executors];
}

function toBrief(goal: Goal): CoachGoalBrief {
  return {
    id: goal.id,
    title: goal.title,
    status: GOAL_STATUS_LABELS[goal.status],
    progress: goal.progress,
    executorId: goal.executorId,
    acceptance: goal.acceptance,
    resultSummary: goal.resultSummary,
  };
}

/** 从选中 Goal 向上找到核心目标（根 Goal） */
export function resolveNorthStarGoal(goalId?: string): Goal | undefined {
  if (goalId) {
    let current = getGoalById(goalId);
    if (!current) return undefined;
    while (current.parentGoalId) {
      const parent = getGoalById(current.parentGoalId);
      if (!parent) break;
      current = parent;
    }
    return current;
  }

  const goals = listGoals();
  return goals.find(
    (g) =>
      !g.parentGoalId &&
      g.status !== "done" &&
      g.status !== "cancelled",
  );
}

export function buildCoachChatContext(goalId?: string): CoachChatContext {
  const settings = loadSettings();
  const goals = listGoals();
  const summary = goals
    .slice(0, 12)
    .map((g) => {
      const indent = g.parentGoalId ? "  ↳ " : "· ";
      return `${indent}${g.title} [${GOAL_STATUS_LABELS[g.status]}] ${g.progress}% (${g.executorId})`;
    })
    .join("\n");

  const selected = goalId ? getGoalById(goalId) : undefined;
  const northStarGoal = resolveNorthStarGoal(goalId);
  const subGoals = northStarGoal
    ? listChildGoals(northStarGoal.id).map(toBrief)
    : [];
  const feedback = goalId ? buildGoalFeedback(goalId) : undefined;

  return {
    goalsSummary: summary || undefined,
    northStar: northStarGoal ? toBrief(northStarGoal) : undefined,
    subGoals: subGoals.length > 0 ? subGoals : undefined,
    selectedGoal: selected ? toBrief(selected) : undefined,
    feedbackNotes: formatFeedbackNotes(feedback),
    workspaceRoot: resolveWorkspaceRoot(settings.workspaceRoot),
    executors: buildExecutorsList(),
    executorSkills: buildExecutorSkillsMap(settings),
    defaultConstraints:
      settings.defaultConstraints.length > 0
        ? settings.defaultConstraints
        : undefined,
  };
}
