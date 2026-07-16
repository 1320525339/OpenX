import { z } from "zod";
import { CoachIntentSchema, RefinedGoalSchema } from "./coach.js";
import { CoachClarifyPayloadSchema } from "./coach-clarify.js";
import { CoachMessageRecordSchema } from "./coach-messages.js";
import { DynamicIslandPayloadSchema } from "./island.js";
import { GoalSchema } from "./goal.js";
import { RunDeltaEventSchema, RunEndStatusSchema } from "./run.js";
import { ChatRoundStatusSchema, PeerRequestSchema } from "./roundtable.js";

export const SseEventTypeSchema = z.enum([
  "goal.updated",
  "goal.deleted",
  "log.append",
  "narration.append",
  "coach.reply",
  "coach.delta",
  "coach.stream.end",
  "coach.message",
  "coach.tool_call",
  "coach.tool_result",
  "chat.round.started",
  "chat.reply.started",
  "chat.reply.delta",
  "chat.reply.completed",
  "chat.reply.failed",
  "chat.round.completed",
  "chat.round.cancelled",
  "chat.peer_request.created",
  "chat.peer_request.resolved",
  "run.started",
  "run.event",
  "run.ended",
  "island.push",
  "attention.changed",
  "desktop.layout_changed",
  "integration.updated",
  "integration.run.updated",
]);
export type SseEventType = z.infer<typeof SseEventTypeSchema>;

/** SSE 命名事件列表（前后端订阅须与此一致） */
export const SSE_EVENT_TYPES = SseEventTypeSchema.options;

export const LogLevelSchema = z.enum(["info", "warn", "error", "debug"]);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export const SseEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("goal.updated"),
    goal: GoalSchema,
    /** 派单凭证（dispatch 成功时附带） */
    receiptId: z.string().optional(),
    activeRunId: z.string().optional(),
  }),
  z.object({
    type: z.literal("goal.deleted"),
    goalId: z.string(),
  }),
  z.object({
    type: z.literal("log.append"),
    goalId: z.string(),
    level: LogLevelSchema,
    message: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("narration.append"),
    message: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("coach.reply"),
    conversationId: z.string(),
    message: z.string(),
    timestamp: z.string(),
    intent: CoachIntentSchema.optional(),
    refined: RefinedGoalSchema.optional(),
    clarify: CoachClarifyPayloadSchema.optional(),
    /** 是否建议用户进入目标精炼（与 HTTP coachChat 对齐） */
    suggestRefine: z.boolean().optional(),
    meta: z
      .object({
        llmError: z.string().optional(),
        quotaExceeded: z.boolean().optional(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal("coach.delta"),
    conversationId: z.string(),
    streamId: z.string(),
    delta: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("coach.stream.end"),
    conversationId: z.string(),
    streamId: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("coach.message"),
    conversationId: z.string(),
    message: CoachMessageRecordSchema,
  }),
  z.object({
    type: z.literal("coach.tool_call"),
    conversationId: z.string(),
    toolName: z.string(),
    args: z.record(z.unknown()).optional(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("coach.tool_result"),
    conversationId: z.string(),
    toolName: z.string(),
    result: z.unknown(),
    timestamp: z.string().optional(),
  }),
  z.object({
    type: z.literal("chat.round.started"),
    conversationId: z.string(),
    roundId: z.string(),
    mode: z.enum(["direct", "diverge"]),
    participantIds: z.array(z.string()),
    estimatedCalls: z.number().int(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("chat.reply.started"),
    conversationId: z.string(),
    roundId: z.string(),
    messageId: z.number().int(),
    speakerId: z.string(),
    streamId: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("chat.reply.delta"),
    conversationId: z.string(),
    roundId: z.string(),
    messageId: z.number().int(),
    speakerId: z.string(),
    streamId: z.string(),
    delta: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("chat.reply.completed"),
    conversationId: z.string(),
    roundId: z.string(),
    messageId: z.number().int(),
    speakerId: z.string(),
    streamId: z.string(),
    text: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("chat.reply.failed"),
    conversationId: z.string(),
    roundId: z.string(),
    messageId: z.number().int(),
    speakerId: z.string(),
    streamId: z.string(),
    error: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("chat.round.completed"),
    conversationId: z.string(),
    roundId: z.string(),
    status: ChatRoundStatusSchema,
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("chat.round.cancelled"),
    conversationId: z.string(),
    roundIds: z.array(z.string()),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("chat.peer_request.created"),
    conversationId: z.string(),
    request: PeerRequestSchema,
    message: CoachMessageRecordSchema,
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("chat.peer_request.resolved"),
    conversationId: z.string(),
    request: PeerRequestSchema,
    message: CoachMessageRecordSchema.optional(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("run.started"),
    goalId: z.string(),
    runId: z.string(),
    executorId: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("run.event"),
    goalId: z.string(),
    runId: z.string(),
    event: RunDeltaEventSchema,
  }),
  z.object({
    type: z.literal("run.ended"),
    goalId: z.string(),
    runId: z.string(),
    status: RunEndStatusSchema,
    summary: z.string().optional(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("island.push"),
    payload: DynamicIslandPayloadSchema,
  }),
  z.object({
    type: z.literal("attention.changed"),
    key: z.string(),
    revision: z.number().int().positive(),
    state: z.enum(["open", "acknowledged", "resolved"]),
    goalId: z.string().optional(),
  }),
  z.object({
    type: z.literal("desktop.layout_changed"),
    scope: z.enum(["console", "conversation"]),
    revision: z.number(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("integration.updated"),
    integrationId: z.string(),
    enabled: z.boolean(),
    health: z.enum(["ok", "degraded", "disabled", "starting"]),
    healthDetail: z.string().optional(),
    diagnosticsRefreshing: z.boolean().optional(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("integration.run.updated"),
    integrationId: z.string(),
    runId: z.string(),
    status: z.string(),
    title: z.string().optional(),
    lane: z.string().optional(),
    goalId: z.string().optional(),
    timestamp: z.string(),
  }),
]);
export type SseEvent = z.infer<typeof SseEventSchema>;
