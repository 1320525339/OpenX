import { z } from "zod";
import { CoachClarifyPayloadSchema } from "./coach-clarify.js";
import { ExecutorIdSchema } from "./executor.js";
import { GoalPrioritySchema } from "./goal.js";
import type { OperatorTier } from "./operator-tier.js";
import type { LlmRuntimeSnapshot } from "./llm-runtime-snapshot.js";
import type { LlmContextSettings } from "./llm-context-config.js";

/** 来自执行器/用户的反馈，供 Coach 优化提示词 */
export const GoalFeedbackSchema = z.object({
  reworkReason: z.string().optional(),
  resultSummary: z.string().optional(),
  recentLogs: z
    .array(z.object({ level: z.string(), message: z.string() }))
    .optional(),
  priorSummaries: z.array(z.string()).optional(),
  /** 历史审查员判定记录（每轮累积） */
  priorReviewRounds: z.array(z.string()).optional(),
});
export type GoalFeedback = z.infer<typeof GoalFeedbackSchema>;

export const RefineInputSchema = z.object({
  userDraft: z.string().min(1),
  constraints: z.array(z.string()).optional(),
  feedback: GoalFeedbackSchema.optional(),
});
export type RefineInput = z.infer<typeof RefineInputSchema>;

/** 任务树中的单个 Goal 摘要，供工头 Coach 汇总与派单 */
export type CoachGoalBrief = {
  id: string;
  title: string;
  status: string;
  progress: number;
  executorId: string;
  acceptance?: string;
  resultSummary?: string;
};

/** 助手多轮对话中的一条记录（含工具结果，对齐 Agent tool_use / tool_result 模型） */
export type CoachChatTurn = {
  role: "user" | "coach" | "tool_result";
  text: string;
  /** tool_result 轮次：工具名，如 propose_work_order */
  toolName?: string;
};

/** Coach 识别的用户意图类型 */
export const CoachIntentSchema = z.enum([
  "task",
  "progress",
  "consult",
  "chitchat",
  "rework",
]);
export type CoachIntent = z.infer<typeof CoachIntentSchema>;

/** 确定性项目上下文包（文件树 + 关键文件摘要） */
export const ContextPackKeyFileSchema = z.object({
  path: z.string(),
  summary: z.string(),
});
export type ContextPackKeyFile = z.infer<typeof ContextPackKeyFileSchema>;

export const ContextPackSchema = z.object({
  root: z.string(),
  fileTree: z.string(),
  keyFiles: z.array(ContextPackKeyFileSchema),
  generatedAt: z.string(),
});
export type ContextPack = z.infer<typeof ContextPackSchema>;

export type CoachChatContext = {
  /** 全部任务一览（扁平列表） */
  goalsSummary?: string;
  /** 用户当前选中的 Goal */
  selectedGoal?: CoachGoalBrief;
  /** 核心目标（North Star）：选中 Goal 的根父级，或最新活跃根 Goal */
  northStar?: CoachGoalBrief;
  /** 核心目标下的子任务 */
  subGoals?: CoachGoalBrief[];
  feedbackNotes?: string;
  /** Pi 执行器使用的工作目录（绝对或相对路径） */
  workspaceRoot?: string;
  /** 可用执行 Agent / 执行器 id */
  executors?: string[];
  /** 各 executor 已启用的 Skills 摘要 */
  executorSkills?: Record<string, string[]>;
  /** 工头角色与行为准则（来自 settings.defaultConstraints） */
  defaultConstraints?: string[];
  /** 对话中启用的 Skills（来自用户选择或服务端解析） */
  enabledSkills?: Array<{ id: string; name: string; desc: string }>;
  /** 对话中启用的 MCP server id 列表 */
  enabledMcps?: Array<{ id: string; name: string }>;
  /** 对话选中的 Agent 角色 id */
  agentId?: string;
  /** 选中 Agent 的展示名（来自 AGENT.md frontmatter） */
  agentName?: string;
  /** 选中 Agent 的正文 rolePrompt（来自 AGENT.md 正文） */
  agentRolePrompt?: string;
  /** 确定性收集的项目上下文 */
  contextPack?: ContextPack;
  /** 工头 API 自控权限分级 */
  operatorTier?: OperatorTier;
  /** 注入 LLM 的运行时快照（时刻、环境、接口、受众预测） */
  runtimeSnapshot?: LlmRuntimeSnapshot;
  /** settings.llmContext 配置切片，供 prompt 渲染 */
  llmContextSettings?: Partial<LlmContextSettings>;
  /** 当前项目名（项目对话） */
  projectName?: string;
  /** 预计算的工头会话前缀（含 checkpoint / 压缩） */
  coachThreadBlock?: string;
  /** 项目级 MEMORY.md 检索片段 */
  projectMemory?: string;
};

/** Coach 一次派单可拆分的子任务 */
export const RefinedSubGoalSchema = z.object({
  title: z.string(),
  acceptance: z.string(),
  executionPrompt: z.string(),
  constraints: z.array(z.string()).optional(),
  executorId: ExecutorIdSchema.optional(),
  priority: GoalPrioritySchema.optional(),
  /** 依赖同批 subGoals 中的索引（0-based） */
  dependsOnIndex: z.array(z.number().int().min(0)).optional(),
  agentId: z.string().optional(),
  mcpIds: z.array(z.string()).optional(),
  skillIds: z.array(z.string()).optional(),
  permissionMode: z
    .enum(["read_only", "ask_write", "full"])
    .optional(),
});
export type RefinedSubGoal = z.infer<typeof RefinedSubGoalSchema>;

export const RefinedGoalSchema = z.object({
  title: z.string(),
  acceptance: z.string(),
  executionPrompt: z.string(),
  constraints: z.array(z.string()),
  executorId: ExecutorIdSchema.optional(),
  priority: GoalPrioritySchema.optional(),
  agentId: z.string().optional(),
  mcpIds: z.array(z.string()).optional(),
  skillIds: z.array(z.string()).optional(),
  /** 与主目标一并创建，或挂到已有 North Star 下的下一批子任务 */
  subGoals: z.array(RefinedSubGoalSchema).optional(),
});
export type RefinedGoal = z.infer<typeof RefinedGoalSchema>;

export const CoachChatInputSchema = z.object({
  message: z.string().min(1),
  conversationId: z.string().min(1),
  goalId: z.string().optional(),
  /** 对话栏选中的 Skill id 列表 */
  skillIds: z.array(z.string()).optional(),
  /** 对话栏选中的 MCP server id 列表 */
  mcpIds: z.array(z.string()).optional(),
  /** @deprecated 工头固定 coach；仅 refined 工单可指定执行角色 agentId */
  agentId: z.string().optional(),
  /** 用户确认「整理成任务单」后的重发：必须产出 refined，不重复保存用户消息 */
  forceRefine: z.boolean().optional(),
  /** 用户取消任务单：只回复对话，禁止产出 refined */
  skipRefine: z.boolean().optional(),
  /** Web 客户端自动附带，用于格式化当前时刻（用户无需配置） */
  clientTimezone: z.string().optional(),
  clientLocale: z.string().optional(),
});
export type CoachChatInput = z.infer<typeof CoachChatInputSchema>;

export const RecommendExecutorInputSchema = z.object({
  title: z.string().optional(),
  acceptance: z.string().optional(),
  executionPrompt: z.string().optional(),
  userDraft: z.string().optional(),
});
export type RecommendExecutorInput = z.infer<typeof RecommendExecutorInputSchema>;

/** Agent 对话统一响应：文本回复 + 可选目标整理结果 */
export const AgentChatResponseSchema = z.object({
  message: z.string(),
  intent: CoachIntentSchema.optional(),
  refined: RefinedGoalSchema.optional(),
  clarify: CoachClarifyPayloadSchema.optional(),
});
export type AgentChatResponse = z.infer<typeof AgentChatResponseSchema>;
