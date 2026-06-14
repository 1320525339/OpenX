import type { CoachChatContext, CoachIntent } from "./coach.js";
import { classifyCoachIntent } from "./coach-intent.js";
import {
  LlmAudienceRuleSchema,
  type LlmAudienceRule,
  type LlmContextSettings,
} from "./llm-context-config.js";

export type LlmAudienceProfile = {
  label: string;
  summary: string;
  matchedRuleId?: string;
};

/** 内置受众规则（可被 settings.llmContext.audienceRules 扩展或替换） */
export const DEFAULT_LLM_AUDIENCE_RULES: LlmAudienceRule[] = [
  {
    id: "discourse_design",
    label: "设计 / 产品探讨者",
    summary:
      "用户在讨论设计、产品或体验而非写代码；按 discourseThinking 深度分析，不派单，引用场景与权衡。",
    messagePattern: "设计|产品|UX|UI|交互|用户体验|原型|信息架构",
    intent: "consult",
    priority: 95,
  },
  {
    id: "discourse_game",
    label: "游戏领域探讨者",
    summary:
      "用户在讨论游戏机制、玩法或行业；从核心循环、受众、成本角度深度分析，不派单。",
    messagePattern: "游戏|玩法|机制|关卡|数值|Steam|手游|端游|氪金",
    intent: "consult",
    priority: 94,
  },
  {
    id: "discourse_finance",
    label: "投资 / 财经探讨者",
    summary:
      "用户在讨论股票或投资逻辑；提供分析框架与风险因素，声明非投资建议，不派单。",
    messagePattern: "股票|投资|理财|基金|债券|期货|大盘|板块|估值|财报",
    intent: "consult",
    priority: 93,
  },
  {
    id: "operator",
    label: "平台操作者 / 集成开发者",
    summary:
      "用户可能在配置 OpenX、调试 API 或自举 Connect；回复应引用可验证的 REST 路径与步骤，避免臆造接口。",
    messagePattern: "api|接口|catalog|bootstrap|mcp|cli|设置|自举|operator",
    priority: 100,
  },
  {
    id: "progress",
    label: "项目负责人 / 验收方",
    summary: "用户关注任务进展与验收；优先对照 North Star 与子任务 resultSummary 汇报。",
    intent: "progress",
    messagePattern: "进展|状态|完成了吗|验收",
    priority: 90,
  },
  {
    id: "rework",
    label: "质量负责人",
    summary: "用户对结果不满意；结合 feedbackNotes 与日志，给出可执行的返工派单。",
    intent: "rework",
    messagePattern: "返工|不对|重做|bug",
    priority: 85,
  },
  {
    id: "reviewer",
    label: "审查协作者",
    summary: "对话角色偏审查；语气应客观、对照 acceptance 与证据。",
    agentId: "reviewer",
    agentRoleIncludes: "审查",
    priority: 80,
  },
  {
    id: "task_driver",
    label: "任务驱动开发者",
    summary: "用户在有明确 Goal 上下文下协作；拆解与派单应服务当前 North Star。",
    requiresNorthStar: true,
    priority: 50,
  },
  {
    id: "selected_goal",
    label: "任务驱动开发者",
    summary: "用户选中了具体 Goal；回复与派单应对齐该任务验收标准。",
    requiresSelectedGoal: true,
    priority: 40,
  },
];

function ruleMatches(
  rule: LlmAudienceRule,
  message: string,
  intent: CoachIntent | undefined,
  context: CoachChatContext,
): boolean {
  if (rule.messagePattern) {
    try {
      if (!new RegExp(rule.messagePattern, "i").test(message)) return false;
    } catch {
      return false;
    }
  }
  if (rule.intent && intent !== rule.intent) return false;
  if (rule.agentId && context.agentId !== rule.agentId) return false;
  if (
    rule.agentRoleIncludes &&
    !context.agentRolePrompt?.includes(rule.agentRoleIncludes)
  ) {
    return false;
  }
  if (rule.requiresNorthStar && !context.northStar) return false;
  if (rule.requiresSelectedGoal && !context.selectedGoal) return false;
  if (
    !rule.messagePattern &&
    !rule.intent &&
    !rule.agentId &&
    !rule.agentRoleIncludes &&
    !rule.requiresNorthStar &&
    !rule.requiresSelectedGoal
  ) {
    return false;
  }
  return true;
}

export function resolveAudienceRules(
  llmContextSettings?: Partial<LlmContextSettings> | null,
): LlmAudienceRule[] {
  const custom = llmContextSettings?.audienceRules;
  if (custom?.length) {
    const parsed = custom.map((r) => LlmAudienceRuleSchema.parse(r));
    return [...parsed].sort((a, b) => b.priority - a.priority);
  }
  return DEFAULT_LLM_AUDIENCE_RULES;
}

export function predictAudienceProfile(
  message: string | undefined,
  context: CoachChatContext,
  llmContextSettings?: Partial<LlmContextSettings> | null,
): LlmAudienceProfile {
  const m = (message ?? "").trim();
  const intent = m ? classifyCoachIntent(m) : undefined;
  const rules = resolveAudienceRules(llmContextSettings);

  for (const rule of rules) {
    if (ruleMatches(rule, m, intent, context)) {
      return {
        label: rule.label,
        summary: rule.summary,
        matchedRuleId: rule.id,
      };
    }
  }

  return {
    label: "通用协作者",
    summary: "首次或泛化对话；先澄清意图，再决定是否整理 Goal。",
    matchedRuleId: "default",
  };
}
