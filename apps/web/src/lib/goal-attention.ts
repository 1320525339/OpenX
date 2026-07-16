import type { Goal } from "@openx/shared";
import { isPausedGoal } from "@openx/shared";

/** 侧栏/顶栏「需要你关注」：含暂停等待开发商决策的任务 */
export function goalNeedsUserAttention(goal: Goal): boolean {
  return (
    goal.status === "awaiting_review" ||
    goal.status === "failed" ||
    goal.effectStatus === "rework" ||
    isPausedGoal(goal)
  );
}
