import { z } from "zod";

export const OperatorTierSchema = z.enum(["off", "read", "operator", "admin"]);
export type OperatorTier = z.infer<typeof OperatorTierSchema>;

export const OPERATOR_TIER_RANK: Record<OperatorTier, number> = {
  off: 0,
  read: 1,
  operator: 2,
  admin: 3,
};

export function tierSatisfies(userTier: OperatorTier, required: OperatorTier): boolean {
  return OPERATOR_TIER_RANK[userTier] >= OPERATOR_TIER_RANK[required];
}

export function operatorToolsEnabled(tier: OperatorTier): boolean {
  return tier !== "off";
}

export const OPERATOR_TIER_LABELS: Record<
  OperatorTier,
  { label: string; description: string }
> = {
  off: {
    label: "关闭",
    description: "工头不调用 OpenX API，行为与默认一致",
  },
  read: {
    label: "只读",
    description: "可查询 API 目录、设置、目标与执行器状态",
  },
  operator: {
    label: "操作员",
    description: "可创建项目/对话/目标、派单、Connect 自举与 Coach 对话",
  },
  admin: {
    label: "管理员",
    description: "可修改 settings、模型渠道、CLI/MCP/Agent（敏感写操作需 UI 确认）",
  },
};
