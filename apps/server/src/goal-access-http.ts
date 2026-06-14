import type { Context } from "hono";
import {
  canMutateGoal,
  goalMutationDeniedMessage,
  type GoalAccessActor,
  type Goal,
} from "@openx/shared";

export function parseGoalAccessActor(c: Context): GoalAccessActor {
  const view = c.req.header("X-OpenX-View")?.trim().toLowerCase();
  const conversationId = c.req.header("X-OpenX-Conversation-Id")?.trim();
  if (view === "console") return { type: "console" };
  if (conversationId) return { type: "conversation", conversationId };
  // 兼容脚本 / 旧客户端：未带头时视为调度台工头
  return { type: "console" };
}

export function goalMutationForbidden(
  c: Context,
  actor: GoalAccessActor,
  goal: Pick<Goal, "conversationId">,
) {
  if (canMutateGoal(actor, goal)) return null;
  return c.json({ error: goalMutationDeniedMessage() }, 403);
}
