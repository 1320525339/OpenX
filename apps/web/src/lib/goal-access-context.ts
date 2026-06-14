import type { GoalAccessActor } from "@openx/shared";

let accessContext: GoalAccessActor = { type: "console" };

export function setGoalAccessContext(ctx: GoalAccessActor): void {
  accessContext = ctx;
}

export function getGoalAccessContext(): GoalAccessActor {
  return accessContext;
}

export function goalAccessHeaders(): Record<string, string> {
  const ctx = getGoalAccessContext();
  if (ctx.type === "console") {
    return { "X-OpenX-View": "console" };
  }
  return {
    "X-OpenX-View": "conversation",
    "X-OpenX-Conversation-Id": ctx.conversationId,
  };
}
