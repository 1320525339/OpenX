import { z } from "zod";
import { GoalDeliverableSchema } from "./deliverable.js";
import { ExecutorIdSchema } from "./executor.js";
import { DispatchContextSchema } from "./dispatch-context.js";

export { ExecutorIdSchema, type ExecutorId } from "./executor.js";

export const GoalStatusSchema = z.enum([
  "draft",
  "running",
  "awaiting_review",
  "done",
  "failed",
  "cancelled",
]);
export type GoalStatus = z.infer<typeof GoalStatusSchema>;

export const EffectStatusSchema = z.enum(["approved", "rework"]);
export type EffectStatus = z.infer<typeof EffectStatusSchema>;

export const GoalPrioritySchema = z.enum(["low", "medium", "high", "critical"]);
export type GoalPriority = z.infer<typeof GoalPrioritySchema>;

export const GoalSchema = z.object({
  id: z.string(),
  /** 所属对话 */
  conversationId: z.string(),
  title: z.string(),
  acceptance: z.string(),
  userDraft: z.string().optional(),
  executionPrompt: z.string(),
  constraints: z.array(z.string()),
  executorId: ExecutorIdSchema,
  status: GoalStatusSchema,
  progress: z.number().min(0).max(100),
  resultSummary: z.string().optional(),
  /** 结构化交付物（执行器上报；优先于 resultSummary 解析） */
  deliverables: z.array(GoalDeliverableSchema).optional(),
  effectStatus: EffectStatusSchema.optional(),
  reworkReason: z.string().optional(),
  parentGoalId: z.string().optional(),
  dependsOn: z.array(z.string()).default([]),
  priority: GoalPrioritySchema.default("medium"),
  /** 自动验收循环：完成后由 Coach 按验收标准判定，通过自动 approve，不通过自动返工 */
  autoReview: z.boolean().optional(),
  /** 自动返工迭代上限（默认 20），防死循环 */
  maxIterations: z.number().int().min(1).max(50).optional(),
  /** 已自动返工次数 */
  iterationCount: z.number().int().min(0).optional(),
  /** 派单快照：对话栏 Persona / MCP / Skill 选择 */
  dispatchContext: DispatchContextSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Goal = z.infer<typeof GoalSchema>;

/** 新建目标默认开启审查员自动验收循环 */
export const DEFAULT_AUTO_REVIEW = true;

export const DEFAULT_MAX_ITERATIONS = 20;

export const SubGoalInputSchema = z.object({
  userDraft: z.string().min(1),
  executorId: ExecutorIdSchema.default("pi"),
  title: z.string().optional(),
  acceptance: z.string().optional(),
  executionPrompt: z.string().optional(),
  constraints: z.array(z.string()).optional(),
  dependsOn: z.array(z.string()).optional(),
  priority: GoalPrioritySchema.optional(),
  agentId: z.string().optional(),
  mcpIds: z.array(z.string()).optional(),
  skillIds: z.array(z.string()).optional(),
  dispatchContext: DispatchContextSchema.optional(),
});
export type SubGoalInput = z.infer<typeof SubGoalInputSchema>;

export const AddSubGoalsSchema = z.object({
  subGoals: z.array(SubGoalInputSchema).min(1),
  autoStart: z.boolean().optional(),
});
export type AddSubGoalsInput = z.infer<typeof AddSubGoalsSchema>;

export const CreateGoalSchema = z.object({
  conversationId: z.string().min(1),
  userDraft: z.string().min(1),
  executorId: ExecutorIdSchema.default("pi"),
  title: z.string().optional(),
  acceptance: z.string().optional(),
  executionPrompt: z.string().optional(),
  constraints: z.array(z.string()).optional(),
  parentGoalId: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
  priority: GoalPrioritySchema.optional(),
  /** 与主目标一并创建的子目标（可依赖主目标 id 或同批 earlier 子目标） */
  subGoals: z.array(SubGoalInputSchema).optional(),
  /** 创建后立即启动；未传时由服务端 settings.autoExecute 决定 */
  autoStart: z.boolean().optional(),
  /** 关联的对话内 refined 消息 id，创建后标记为已消费 */
  refinedMessageId: z.number().int().positive().optional(),
  /** 开启自动验收循环 */
  autoReview: z.boolean().optional(),
  /** 自动返工迭代上限 */
  maxIterations: z.number().int().min(1).max(50).optional(),
  agentId: z.string().optional(),
  mcpIds: z.array(z.string()).optional(),
  skillIds: z.array(z.string()).optional(),
  dispatchContext: DispatchContextSchema.optional(),
});
export type CreateGoalInput = z.infer<typeof CreateGoalSchema>;

export const UpdateGoalSchema = z.object({
  title: z.string().optional(),
  acceptance: z.string().optional(),
  executionPrompt: z.string().optional(),
  constraints: z.array(z.string()).optional(),
  executorId: ExecutorIdSchema.optional(),
  dependsOn: z.array(z.string()).optional(),
  priority: GoalPrioritySchema.optional(),
});

export const GOAL_PRIORITY_WEIGHT: Record<GoalPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};
export type UpdateGoalInput = z.infer<typeof UpdateGoalSchema>;

export const ReworkSchema = z.object({
  reason: z.string().optional(),
});

export const BatchGoalsActionSchema = z.enum(["start", "cancel", "approve", "delete"]);
export type BatchGoalsAction = z.infer<typeof BatchGoalsActionSchema>;

export const BatchGoalsSchema = z.object({
  action: BatchGoalsActionSchema,
  ids: z.array(z.string()).min(1),
});
export type BatchGoalsInput = z.infer<typeof BatchGoalsSchema>;

export function canTransition(from: GoalStatus, to: GoalStatus): boolean {
  const allowed: Record<GoalStatus, GoalStatus[]> = {
    draft: ["running", "cancelled"],
    running: ["awaiting_review", "failed", "cancelled"],
    awaiting_review: ["done", "running", "cancelled"],
    done: [],
    failed: ["running", "cancelled"],
    cancelled: [],
  };
  return allowed[from]?.includes(to) ?? false;
}

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  draft: "先放着",
  running: "正在推进",
  awaiting_review: "等你确认",
  done: "已完成",
  failed: "卡住了",
  cancelled: "已取消",
};
