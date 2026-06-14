import { z } from "zod";

/** 执行器派单权限：只读侦察 / 写前确认 / 完全授权 */
export const DispatchPermissionModeSchema = z.enum([
  "read_only",
  "ask_write",
  "full",
]);
export type DispatchPermissionMode = z.infer<typeof DispatchPermissionModeSchema>;

/** 创建 Goal 时冻结的派单上下文（Coach Persona / MCP / Skill 快照） */
export const DispatchContextSchema = z.object({
  agentId: z.string().optional(),
  mcpIds: z.array(z.string()).optional(),
  skillIds: z.array(z.string()).optional(),
  permissionMode: DispatchPermissionModeSchema.optional(),
});
export type DispatchContext = z.infer<typeof DispatchContextSchema>;

export function normalizeDispatchContext(
  input?: Partial<DispatchContext> | null,
): DispatchContext | undefined {
  if (!input) return undefined;
  const agentId = input.agentId?.trim() || undefined;
  const mcpIds = input.mcpIds?.map((id) => id.trim()).filter(Boolean);
  const skillIds = input.skillIds?.map((id) => id.trim()).filter(Boolean);
  const permissionMode = input.permissionMode;
  if (
    !agentId &&
    !mcpIds?.length &&
    !skillIds?.length &&
    !permissionMode
  ) {
    return undefined;
  }
  return {
    ...(agentId ? { agentId } : {}),
    ...(mcpIds?.length ? { mcpIds } : {}),
    ...(skillIds?.length ? { skillIds } : {}),
    ...(permissionMode ? { permissionMode } : {}),
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
    if (part.permissionMode) merged.permissionMode = part.permissionMode;
  }
  return normalizeDispatchContext(merged);
}

export const DISPATCH_PERMISSION_PROMPTS: Record<
  DispatchPermissionMode,
  string
> = {
  read_only: [
    "【派单权限 · 只读侦察】",
    "- 仅允许阅读代码/配置/日志、运行只读诊断命令",
    "- 禁止创建、修改、删除文件或目录",
    "- 禁止安装依赖、部署、执行会改变系统状态的写操作",
    "- 结果摘要须列出证据路径与观察结论",
  ].join("\n"),
  ask_write: [
    "【派单权限 · 写前确认】",
    "- 读操作与诊断可自由执行",
    "- 任何会修改仓库/配置/数据库的操作，须先在结果摘要中列出拟修改项并等待工头确认",
    "- 未获确认前不得落盘写入",
  ].join("\n"),
  full: [
    "【派单权限 · 完全授权】",
    "- 可按任务需要读写代码与配置，仍须遵守验收标准与约束条件",
  ].join("\n"),
};

export function buildDispatchPermissionBlock(
  mode?: DispatchPermissionMode,
): string | undefined {
  if (!mode) return undefined;
  return DISPATCH_PERMISSION_PROMPTS[mode];
}

export const DISPATCH_PERMISSION_LABELS: Record<
  DispatchPermissionMode,
  { label: string; description: string }
> = {
  read_only: {
    label: "只读侦察",
    description: "仅阅读与诊断，禁止修改文件",
  },
  ask_write: {
    label: "写前确认",
    description: "写入前须在结果摘要中说明拟修改项",
  },
  full: {
    label: "完全授权",
    description: "可按任务需要读写代码与配置",
  },
};
