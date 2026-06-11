import {
  mergeDispatchContext,
  type DispatchContext,
  type RefinedGoal,
} from "@openx/shared";

export function enrichRefinedWithChatContext(
  refined: RefinedGoal,
  ctx: DispatchContext,
): RefinedGoal {
  const merged = mergeDispatchContext(refined, ctx);
  if (!merged) return refined;
  return {
    ...refined,
    agentId: merged.agentId,
    mcpIds: merged.mcpIds,
    skillIds: merged.skillIds,
  };
}

export function buildCreateGoalDispatch(
  refined: RefinedGoal,
  ctx: DispatchContext,
): DispatchContext | undefined {
  return mergeDispatchContext(refined, ctx);
}
