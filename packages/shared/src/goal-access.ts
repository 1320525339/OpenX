import type { Goal } from "./goal.js";

/** 客户端 / API 声明的操作者视角 */
export type GoalAccessActor =
  | { type: "console" }
  | { type: "conversation"; conversationId: string };

export function canMutateGoal(
  actor: GoalAccessActor,
  goal: Pick<Goal, "conversationId">,
): boolean {
  if (actor.type === "console") return true;
  return goal.conversationId === actor.conversationId;
}

export function goalMutationDeniedMessage(): string {
  return "无权修改其他对话的任务单，仅可查看";
}
