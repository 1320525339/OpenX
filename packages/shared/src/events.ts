import { z } from "zod";
import { RefinedGoalSchema } from "./coach.js";
import { GoalSchema } from "./goal.js";
import { RunDeltaEventSchema, RunEndStatusSchema } from "./run.js";

export const SseEventTypeSchema = z.enum([
  "goal.updated",
  "goal.deleted",
  "log.append",
  "narration.append",
  "coach.reply",
  "run.started",
  "run.event",
  "run.ended",
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
    message: z.string(),
    timestamp: z.string(),
    refined: RefinedGoalSchema.optional(),
    meta: z
      .object({
        llmError: z.string().optional(),
        quotaExceeded: z.boolean().optional(),
      })
      .optional(),
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
]);
export type SseEvent = z.infer<typeof SseEventSchema>;
