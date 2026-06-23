import type { Goal } from "./goal.js";

/** 用户可见三态：未完成 / 失败 / 已完成 */
export type GoalDisplayOutcome = "incomplete" | "failed" | "done";

export function goalDisplayOutcome(goal: Goal): GoalDisplayOutcome {
  if (goal.status === "done") return "done";
  if (goal.status === "failed" || goal.status === "cancelled") return "failed";
  return "incomplete";
}

export const GOAL_DISPLAY_OUTCOME_LABELS: Record<GoalDisplayOutcome, string> = {
  incomplete: "未完成",
  failed: "失败",
  done: "已完成",
};

/** 主标签（三态） */
export function goalDisplayLabel(goal: Goal): string {
  const outcome = goalDisplayOutcome(goal);
  if (outcome === "done") return GOAL_DISPLAY_OUTCOME_LABELS.done;
  if (outcome === "failed") {
    return goal.status === "cancelled" ? "已取消" : GOAL_DISPLAY_OUTCOME_LABELS.failed;
  }
  return GOAL_DISPLAY_OUTCOME_LABELS.incomplete;
}

/** 副标签（细分进度，用于卡片第二行） */
export function goalDisplayHint(goal: Goal): string | null {
  if (goal.status === "awaiting_review") return "待验收";
  if (goal.status === "running") {
    if (goal.crewStatus === "awaiting_user") return "等待开发商决策";
    if (goal.effectStatus === "rework") return "返工中";
    return "进行中";
  }
  if (goal.status === "draft") return "未开始";
  if (goal.status === "done") return null;
  if (goal.status === "failed") return "执行失败";
  if (goal.status === "cancelled") return "已取消";
  return null;
}

export function goalMatchesDisplayFilter(goal: Goal, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "incomplete") return goalDisplayOutcome(goal) === "incomplete";
  if (filter === "failed") return goalDisplayOutcome(goal) === "failed";
  if (filter === "done") return goalDisplayOutcome(goal) === "done";
  if (filter === "rework") {
    return goal.status === "running" && goal.effectStatus === "rework";
  }
  if (filter === "awaiting_review") return goal.status === "awaiting_review";
  if (filter === "running") return goal.status === "running";
  if (filter === "draft") return goal.status === "draft";
  return goal.status === filter;
}
