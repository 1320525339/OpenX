import { z } from "zod";
import { ExecutorIdSchema } from "./executor.js";

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
  title: z.string(),
  acceptance: z.string(),
  userDraft: z.string().optional(),
  executionPrompt: z.string(),
  constraints: z.array(z.string()),
  executorId: ExecutorIdSchema,
  status: GoalStatusSchema,
  progress: z.number().min(0).max(100),
  resultSummary: z.string().optional(),
  effectStatus: EffectStatusSchema.optional(),
  reworkReason: z.string().optional(),
  parentGoalId: z.string().optional(),
  dependsOn: z.array(z.string()).default([]),
  priority: GoalPrioritySchema.default("medium"),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Goal = z.infer<typeof GoalSchema>;

export const SubGoalInputSchema = z.object({
  userDraft: z.string().min(1),
  executorId: ExecutorIdSchema.default("pi"),
  title: z.string().optional(),
  acceptance: z.string().optional(),
  executionPrompt: z.string().optional(),
  constraints: z.array(z.string()).optional(),
  dependsOn: z.array(z.string()).optional(),
  priority: GoalPrioritySchema.optional(),
});
export type SubGoalInput = z.infer<typeof SubGoalInputSchema>;

export const AddSubGoalsSchema = z.object({
  subGoals: z.array(SubGoalInputSchema).min(1),
  autoStart: z.boolean().optional(),
});
export type AddSubGoalsInput = z.infer<typeof AddSubGoalsSchema>;

export const CreateGoalSchema = z.object({
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
  draft: "草稿",
  running: "进行中",
  awaiting_review: "待确认",
  done: "已完成",
  failed: "失败",
  cancelled: "已取消",
};
