import { z } from "zod";
import { ExecutorIdSchema } from "./executor.js";
import { GoalPrioritySchema } from "./goal.js";

/** 来自执行器/用户的反馈，供 Coach 优化提示词 */
export const GoalFeedbackSchema = z.object({
  reworkReason: z.string().optional(),
  resultSummary: z.string().optional(),
  recentLogs: z
    .array(z.object({ level: z.string(), message: z.string() }))
    .optional(),
  priorSummaries: z.array(z.string()).optional(),
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
};

/** Coach 一次派单可拆分的子任务 */
export const RefinedSubGoalSchema = z.object({
  title: z.string(),
  acceptance: z.string(),
  executionPrompt: z.string(),
  constraints: z.array(z.string()).optional(),
  executorId: ExecutorIdSchema.optional(),
  priority: GoalPrioritySchema.optional(),
});
export type RefinedSubGoal = z.infer<typeof RefinedSubGoalSchema>;

export const RefinedGoalSchema = z.object({
  title: z.string(),
  acceptance: z.string(),
  executionPrompt: z.string(),
  constraints: z.array(z.string()),
  /** 与主目标一并创建，或挂到已有 North Star 下的下一批子任务 */
  subGoals: z.array(RefinedSubGoalSchema).optional(),
});
export type RefinedGoal = z.infer<typeof RefinedGoalSchema>;

export const CoachChatInputSchema = z.object({
  message: z.string().min(1),
  goalId: z.string().optional(),
  /** 对话栏选中的 Skill id 列表 */
  skillIds: z.array(z.string()).optional(),
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
  refined: RefinedGoalSchema.optional(),
});
export type AgentChatResponse = z.infer<typeof AgentChatResponseSchema>;
