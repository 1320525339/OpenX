import { z } from "zod";
import { RefinedGoalSchema } from "./coach.js";
import { GoalStatusSchema } from "./goal.js";
import { GoalRunStateSchema } from "./run.js";

export const CoachMessageKindSchema = z.enum(["text", "execution", "refined"]);
export type CoachMessageKind = z.infer<typeof CoachMessageKindSchema>;

export const CoachExecutionMetaSchema = z.object({
  goalId: z.string(),
  goalTitle: z.string(),
  goalStatus: GoalStatusSchema,
  runId: z.string(),
  run: GoalRunStateSchema,
});
export type CoachExecutionMeta = z.infer<typeof CoachExecutionMetaSchema>;

export const CoachTextMessageSchema = z.object({
  id: z.number(),
  conversationId: z.string(),
  kind: z.literal("text"),
  role: z.enum(["user", "coach"]),
  text: z.string(),
  timestamp: z.string(),
});
export type CoachTextMessage = z.infer<typeof CoachTextMessageSchema>;

export const CoachExecutionMessageSchema = z.object({
  id: z.number(),
  conversationId: z.string(),
  kind: z.literal("execution"),
  timestamp: z.string(),
  execution: CoachExecutionMetaSchema,
});
export type CoachExecutionMessage = z.infer<typeof CoachExecutionMessageSchema>;

export const CoachRefinedMessageSchema = z.object({
  id: z.number(),
  conversationId: z.string(),
  kind: z.literal("refined"),
  timestamp: z.string(),
  refined: RefinedGoalSchema,
  /** 已从该工单预览创建的目标；有值时不再作为待确认工单恢复 */
  linkedGoalId: z.string().optional(),
});
export type CoachRefinedMessage = z.infer<typeof CoachRefinedMessageSchema>;

/** Coach 通过 propose_work_order 工具挂起的任务单（UI 确认/取消后回传 tool_result） */
export const WORK_ORDER_TOOL_NAME = "propose_work_order" as const;

export const WorkOrderToolOutcomeSchema = z.enum(["dismissed", "confirmed"]);
export type WorkOrderToolOutcome = z.infer<typeof WorkOrderToolOutcomeSchema>;

export const WorkOrderToolResultSchema = z.object({
  toolName: z.literal(WORK_ORDER_TOOL_NAME),
  refinedMessageId: z.number(),
  outcome: WorkOrderToolOutcomeSchema,
  title: z.string(),
  dismissed: z.boolean().optional(),
  goalId: z.string().optional(),
});
export type WorkOrderToolResult = z.infer<typeof WorkOrderToolResultSchema>;

export const CoachToolResultMessageSchema = z.object({
  id: z.number(),
  conversationId: z.string(),
  kind: z.literal("tool_result"),
  timestamp: z.string(),
  toolResult: WorkOrderToolResultSchema,
});
export type CoachToolResultMessage = z.infer<typeof CoachToolResultMessageSchema>;

/** 用户对挂起任务单的确认结果，回传 LLM 而非伪造用户消息 */
export const RefinedWorkOrderRespondSchema = z.object({
  conversationId: z.string().min(1),
  outcome: WorkOrderToolOutcomeSchema,
  goalId: z.string().optional(),
});
export type RefinedWorkOrderRespondInput = z.infer<
  typeof RefinedWorkOrderRespondSchema
>;

export const CoachMessageRecordSchema = z.discriminatedUnion("kind", [
  CoachTextMessageSchema,
  CoachExecutionMessageSchema,
  CoachRefinedMessageSchema,
  CoachToolResultMessageSchema,
]);
export type CoachMessageRecord = z.infer<typeof CoachMessageRecordSchema>;
