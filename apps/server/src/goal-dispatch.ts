import {
  mergeDispatchContext,
  normalizeDispatchContext,
  type DispatchContext,
  type Goal,
  type RefinedGoal,
} from "@openx/shared";

export type DispatchInput = {
  agentId?: string;
  mcpIds?: string[];
  skillIds?: string[];
  dispatchContext?: DispatchContext;
};

/** 将对话栏 Persona / MCP / Skill 合并进 refined 工单 */
export function enrichRefinedWithChatDispatch(
  refined: RefinedGoal,
  input: Pick<DispatchInput, "agentId" | "mcpIds" | "skillIds">,
): RefinedGoal {
  const merged = mergeDispatchContext(refined, {
    agentId: input.agentId,
    mcpIds: input.mcpIds,
    skillIds: input.skillIds,
  });
  if (!merged) return refined;
  return {
    ...refined,
    agentId: merged.agentId,
    mcpIds: merged.mcpIds,
    skillIds: merged.skillIds,
  };
}

/** 从创建请求 / refined 工单 / 父目标合并派单快照 */
export function buildGoalDispatchContext(
  input: DispatchInput,
  refined?: Pick<RefinedGoal, "agentId" | "mcpIds" | "skillIds">,
  parent?: Pick<Goal, "dispatchContext">,
): DispatchContext | undefined {
  return normalizeDispatchContext(
    mergeDispatchContext(
      parent?.dispatchContext,
      refined
        ? {
            agentId: refined.agentId,
            mcpIds: refined.mcpIds,
            skillIds: refined.skillIds,
          }
        : undefined,
      input.dispatchContext,
      {
        agentId: input.agentId,
        mcpIds: input.mcpIds,
        skillIds: input.skillIds,
      },
    ),
  );
}
