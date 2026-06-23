import { z } from "zod";
import { CoachClarifyPayloadSchema } from "./coach-clarify.js";
import { RefinedGoalSchema } from "./coach.js";
import { GoalStatusSchema } from "./goal.js";
import { GoalRunStateSchema } from "./run.js";
import { ClarifyToolResultSchema } from "./coach-clarify.js";
import {
  CoachDispatchPermissionPayloadSchema,
  DispatchPermissionToolResultSchema,
} from "./coach-dispatch-permission.js";

export const CoachMessageKindSchema = z.enum([
  "text",
  "execution",
  "refined",
  "clarify",
  "tool_result",
  "operator_action",
  "dispatch_permission",
]);
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
  /** 工头↔施工队等任务内消息关联的目标 */
  linkedGoalId: z.string().optional(),
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
  /** 由澄清卡回答后生成的工单时，对应 clarify 消息 id */
  linkedClarifyMessageId: z.number().optional(),
});
export type CoachRefinedMessage = z.infer<typeof CoachRefinedMessageSchema>;

export const CoachClarifyMessageSchema = z.object({
  id: z.number(),
  conversationId: z.string(),
  kind: z.literal("clarify"),
  timestamp: z.string(),
  clarify: CoachClarifyPayloadSchema,
  /** 用户回答澄清后生成的工单消息 id（coach_messages.id） */
  linkedRefinedMessageId: z.number().optional(),
});
export type CoachClarifyMessage = z.infer<typeof CoachClarifyMessageSchema>;

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

/** Coach 通过 openx_call_api 挂起的 admin 写操作（UI 确认/取消后回传 tool_result） */
export const OPERATOR_ACTION_TOOL_NAME = "openx_call_api" as const;

export const OperatorActionToolOutcomeSchema = z.enum(["confirmed", "dismissed"]);
export type OperatorActionToolOutcome = z.infer<typeof OperatorActionToolOutcomeSchema>;

export const OperatorActionToolResultSchema = z.object({
  toolName: z.literal(OPERATOR_ACTION_TOOL_NAME),
  operatorMessageId: z.number(),
  pendingActionId: z.string(),
  outcome: OperatorActionToolOutcomeSchema,
  method: z.string(),
  path: z.string(),
  summary: z.string(),
  apiOk: z.boolean().optional(),
  apiStatus: z.number().optional(),
  apiError: z.string().optional(),
});
export type OperatorActionToolResult = z.infer<typeof OperatorActionToolResultSchema>;

export const CoachToolResultPayloadSchema = z.discriminatedUnion("toolName", [
  WorkOrderToolResultSchema,
  ClarifyToolResultSchema,
  OperatorActionToolResultSchema,
  DispatchPermissionToolResultSchema,
]);
export type CoachToolResultPayload = z.infer<typeof CoachToolResultPayloadSchema>;

export const OperatorActionRespondSchema = z.object({
  conversationId: z.string().min(1),
  outcome: OperatorActionToolOutcomeSchema,
});
export type OperatorActionRespondInput = z.infer<typeof OperatorActionRespondSchema>;

export const CoachToolResultMessageSchema = z.object({
  id: z.number(),
  conversationId: z.string(),
  kind: z.literal("tool_result"),
  timestamp: z.string(),
  toolResult: CoachToolResultPayloadSchema,
});
export type CoachToolResultMessage = z.infer<typeof CoachToolResultMessageSchema>;

export const OperatorActionMetaSchema = z.object({
  pendingActionId: z.string(),
  method: z.string(),
  path: z.string(),
  summary: z.string(),
  reason: z.string().optional(),
  status: z.enum(["pending", "confirmed", "dismissed"]).default("pending"),
});
export type OperatorActionMeta = z.infer<typeof OperatorActionMetaSchema>;

export const CoachOperatorActionMessageSchema = z.object({
  id: z.number(),
  conversationId: z.string(),
  kind: z.literal("operator_action"),
  timestamp: z.string(),
  operatorAction: OperatorActionMetaSchema,
});
export type CoachOperatorActionMessage = z.infer<
  typeof CoachOperatorActionMessageSchema
>;

export const CoachDispatchPermissionMessageSchema = z.object({
  id: z.number(),
  conversationId: z.string(),
  kind: z.literal("dispatch_permission"),
  timestamp: z.string(),
  dispatchPermission: CoachDispatchPermissionPayloadSchema,
});
export type CoachDispatchPermissionMessage = z.infer<
  typeof CoachDispatchPermissionMessageSchema
>;

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
  CoachClarifyMessageSchema,
  CoachToolResultMessageSchema,
  CoachOperatorActionMessageSchema,
  CoachDispatchPermissionMessageSchema,
]);
export type CoachMessageRecord = z.infer<typeof CoachMessageRecordSchema>;
