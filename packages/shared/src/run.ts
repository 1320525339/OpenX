import { z } from "zod";

export const RunEndStatusSchema = z.enum(["completed", "failed", "cancelled", "paused"]);
export type RunEndStatus = z.infer<typeof RunEndStatusSchema>;

const runTimestamp = z.string();

export const ToolFileDiffSchema = z.object({
  diff: z.string(),
  added: z.number(),
  removed: z.number(),
  path: z.string().optional(),
});
export type ToolFileDiff = z.infer<typeof ToolFileDiffSchema>;

const textDeltaEvent = z.object({
  type: z.literal("text.delta"),
  delta: z.string(),
  timestamp: runTimestamp,
});

const thinkingDeltaEvent = z.object({
  type: z.literal("thinking.delta"),
  delta: z.string(),
  timestamp: runTimestamp,
});

const toolStartEvent = z.object({
  type: z.literal("tool.start"),
  tool: z.string(),
  toolCallId: z.string().optional(),
  argsPreview: z.string().optional(),
  timestamp: runTimestamp,
});

const toolUpdateEvent = z.object({
  type: z.literal("tool.update"),
  tool: z.string(),
  toolCallId: z.string().optional(),
  outputPreview: z.string().optional(),
  timestamp: runTimestamp,
});

const toolEndEvent = z.object({
  type: z.literal("tool.end"),
  tool: z.string(),
  toolCallId: z.string().optional(),
  isError: z.boolean().optional(),
  resultPreview: z.string().optional(),
  fileDiff: ToolFileDiffSchema.optional(),
  timestamp: runTimestamp,
});

const statusEvent = z.object({
  type: z.literal("status"),
  message: z.string(),
  timestamp: runTimestamp,
});

/** 单次 Goal 执行的流式事件（Run 层，区别于 Goal 静态 brief） */
export const RunStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("run.start"),
    runId: z.string(),
    executorId: z.string(),
    timestamp: runTimestamp,
  }),
  textDeltaEvent,
  thinkingDeltaEvent,
  toolStartEvent,
  toolUpdateEvent,
  toolEndEvent,
  statusEvent,
  z.object({
    type: z.literal("run.end"),
    status: RunEndStatusSchema,
    summary: z.string().optional(),
    timestamp: runTimestamp,
  }),
]);
export type RunStreamEvent = z.infer<typeof RunStreamEventSchema>;

/** 不含 run.start/run.end 的增量事件（SSE run.event 载荷） */
export const RunDeltaEventSchema = z.discriminatedUnion("type", [
  textDeltaEvent,
  thinkingDeltaEvent,
  toolStartEvent,
  toolUpdateEvent,
  toolEndEvent,
  statusEvent,
]);
export type RunDeltaEvent = z.infer<typeof RunDeltaEventSchema>;

const MAX_LIVE_TEXT = 8000;
const MAX_THINKING_TEXT = 4000;
const MAX_EVENTS = 400;

export const GoalRunStateSchema = z.object({
  goalId: z.string(),
  runId: z.string().nullable(),
  active: z.boolean(),
  executorId: z.string().optional(),
  events: z.array(RunStreamEventSchema),
  liveText: z.string(),
  thinkingText: z.string().optional().default(""),
  lastEndStatus: RunEndStatusSchema.optional(),
});

export type GoalRunState = z.infer<typeof GoalRunStateSchema>;

export function createEmptyRunState(goalId: string): GoalRunState {
  return {
    goalId,
    runId: null,
    active: false,
    events: [],
    liveText: "",
    thinkingText: "",
  };
}

export function applyRunStreamEvent(state: GoalRunState, event: RunStreamEvent): GoalRunState {
  const next: GoalRunState = {
    ...state,
    events: [...state.events, event].slice(-MAX_EVENTS),
    liveText: state.liveText,
    thinkingText: state.thinkingText,
  };
  if (event.type === "run.start") {
    next.runId = event.runId;
    next.active = true;
    next.executorId = event.executorId;
    next.liveText = "";
    next.thinkingText = "";
    next.lastEndStatus = undefined;
  }
  if (event.type === "text.delta") {
    next.liveText = (state.liveText + event.delta).slice(-MAX_LIVE_TEXT);
  }
  if (event.type === "thinking.delta") {
    next.thinkingText = (state.thinkingText + event.delta).slice(-MAX_THINKING_TEXT);
  }
  if (event.type === "run.end") {
    next.active = false;
    next.lastEndStatus = event.status;
  }
  return next;
}

/** run 已结束且为工头暂停等待开发商决策 */
export function isRunPausedAwaitingUser(state: GoalRunState): boolean {
  return !state.active && state.lastEndStatus === "paused";
}

export function applyRunDelta(state: GoalRunState, event: RunDeltaEvent): GoalRunState {
  return applyRunStreamEvent(state, event as RunStreamEvent);
}
