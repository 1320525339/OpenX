import { z } from "zod";

/** 创建 Goal 时冻结的派单上下文（Coach Persona / MCP / Skill 快照） */
export const DispatchContextSchema = z.object({
  agentId: z.string().optional(),
  mcpIds: z.array(z.string()).optional(),
  skillIds: z.array(z.string()).optional(),
});
export type DispatchContext = z.infer<typeof DispatchContextSchema>;

export function normalizeDispatchContext(
  input?: Partial<DispatchContext> | null,
): DispatchContext | undefined {
  if (!input) return undefined;
  const agentId = input.agentId?.trim() || undefined;
  const mcpIds = input.mcpIds?.map((id) => id.trim()).filter(Boolean);
  const skillIds = input.skillIds?.map((id) => id.trim()).filter(Boolean);
  if (!agentId && !mcpIds?.length && !skillIds?.length) return undefined;
  return {
    ...(agentId ? { agentId } : {}),
    ...(mcpIds?.length ? { mcpIds } : {}),
    ...(skillIds?.length ? { skillIds } : {}),
  };
}

/** 合并多路 dispatch 配置（后者覆盖前者） */
export function mergeDispatchContext(
  ...parts: Array<Partial<DispatchContext> | undefined | null>
): DispatchContext | undefined {
  const merged: Partial<DispatchContext> = {};
  for (const part of parts) {
    if (!part) continue;
    if (part.agentId?.trim()) merged.agentId = part.agentId.trim();
    if (part.mcpIds?.length) merged.mcpIds = part.mcpIds;
    if (part.skillIds?.length) merged.skillIds = part.skillIds;
  }
  return normalizeDispatchContext(merged);
}
