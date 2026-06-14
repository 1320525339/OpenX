import { z } from "zod";
import { CoachIntentSchema, RefinedGoalSchema } from "./coach.js";
import { CoachClarifyPayloadSchema } from "./coach-clarify.js";
import { CoachMessageRecordSchema } from "./coach-messages.js";
import { DynamicIslandPayloadSchema } from "./island.js";
import { GoalSchema } from "./goal.js";
import { RunDeltaEventSchema, RunEndStatusSchema } from "./run.js";

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
  "run.started",
  "run.event",
  "run.ended",
  "island.push",
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
    /** Coach 建议把这条消息整理成任务单（待用户轻确认） */
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
]);
export type SseEvent = z.infer<typeof SseEventSchema>;
