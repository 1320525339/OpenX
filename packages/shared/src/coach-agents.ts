/** 对话 Agent 角色（Coach 上下文 + 派单 prompt 前置） */
export const COACH_AGENT_ROLES: Record<
  string,
  { name: string; desc: string; rolePrompt: string }
> = {
  coach: {
    name: "工头助手",
    desc: "拆解目标、对话协调、跟踪进展",
    rolePrompt:
      "你是 OpenX 工头助手，负责拆解目标、跟踪进展、协调 Pi 在本机执行，输出清晰可派单的 brief。",
  },
  coder: {
    name: "编码助手",
    desc: "在本机工作目录写代码、跑命令",
    rolePrompt:
      "你是编码执行助手，专注在本机工作目录完成代码与命令类任务，输出可验收结果，遵守约束不越权。",
  },
  reviewer: {
    name: "审查员",
    desc: "检查产出与验收标准",
    rolePrompt:
      "你是审查员，对照验收标准检查产出，指出差距与返工建议，不直接修改代码。",
  },
};

export function resolveAgentRolePrompt(agentId?: string): string | undefined {
  if (!agentId) return undefined;
  return COACH_AGENT_ROLES[agentId]?.rolePrompt;
}

/** 对话 MCP 元数据（与 settings.mcpServers.id 对齐时可派单） */
export const COACH_MCP_CATALOG = [
  {
    id: "openx",
    name: "OpenX API",
    desc: "调用 OpenX 全部 REST 接口（目标/Coach/设置/Connect 等），支持项目自举",
  },
  { id: "browser", name: "浏览器", desc: "页面导航、截图与交互（IDE Browser MCP）" },
  { id: "workspace", name: "工作区", desc: "项目与工作区控制（App Control MCP）" },
  { id: "filesystem", name: "文件 MCP", desc: "通过 MCP 读写与检索文件" },
] as const;
