import type { Goal } from "@openx/shared";

/** 侧栏/顶栏「需要你关注」：含工头等待开发商决策的运行中任务 */
export function goalNeedsUserAttention(goal: Goal): boolean {
  return (
    goal.status === "awaiting_review" ||
    goal.status === "failed" ||
    goal.effectStatus === "rework" ||
    (goal.status === "running" && goal.crewStatus === "awaiting_user")
  );
}
