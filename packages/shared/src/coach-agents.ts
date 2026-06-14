/** 工头对话固定身份（用户不切换） */
export const FOREMAN_AGENT_ID = "coach";

/** 派单执行默认角色 prompt（注入 Pi/ACP，非聊天人格） */
export const DEFAULT_EXECUTION_AGENT_ID = "coder";

/** 自动验收角色（仅 auto-review 流水线，非聊天人格） */
export const REVIEW_AGENT_ID = "reviewer";

/** Agent 角色定义：工头 / 执行 / 验收（后两者为阶段配置，不在对话栏选择） */
export const COACH_AGENT_ROLES: Record<
  string,
  { name: string; desc: string; rolePrompt: string }
> = {
  coach: {
    name: "工头助手",
    desc: "拆解目标、对话协调、跟踪进展",
    rolePrompt:
      "你是 OpenX 工头助手，负责定位用户问题、收集前置约束、拆解目标、跟踪进展，并输出完整可派单的 brief 给 Pi 执行。",
  },
  coder: {
    name: "编码助手",
    desc: "在本机工作目录写代码、跑命令",
    rolePrompt:
      "你是编码执行助手。严格按工头 brief 中的「已知事实」「待核实项」「调查入口」「范围边界」执行：先完成待核实项的证据收集，再在约束内实施。输出可验收结果与关键证据，不越权、不臆造。",
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
