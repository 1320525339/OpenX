import { z } from "zod";

export const RunEndStatusSchema = z.enum(["completed", "failed", "cancelled"]);
export type RunEndStatus = z.infer<typeof RunEndStatusSchema>;

/** 单次 Goal 执行的流式事件（Run 层，区别于 Goal 静态 brief） */
export const RunStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("run.start"),
    runId: z.string(),
    executorId: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("text.delta"),
    delta: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("tool.start"),
    tool: z.string(),
    argsPreview: z.string().optional(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("tool.end"),
    tool: z.string(),
    isError: z.boolean().optional(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("status"),
    message: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("run.end"),
    status: RunEndStatusSchema,
    summary: z.string().optional(),
    timestamp: z.string(),
  }),
]);
export type RunStreamEvent = z.infer<typeof RunStreamEventSchema>;

/** 不含 run.start/run.end 的增量事件（SSE run.event 载荷） */
export const RunDeltaEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text.delta"),
    delta: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("tool.start"),
    tool: z.string(),
    argsPreview: z.string().optional(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("tool.end"),
    tool: z.string(),
    isError: z.boolean().optional(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal("status"),
    message: z.string(),
    timestamp: z.string(),
  }),
]);
export type RunDeltaEvent = z.infer<typeof RunDeltaEventSchema>;

export type GoalRunState = {
  goalId: string;
  runId: string | null;
  active: boolean;
  executorId?: string;
  events: RunStreamEvent[];
  /** 累积 assistant 文本，便于 UI 展示 */
  liveText: string;
};

export function createEmptyRunState(goalId: string): GoalRunState {
  return { goalId, runId: null, active: false, events: [], liveText: "" };
}

export function applyRunStreamEvent(state: GoalRunState, event: RunStreamEvent): GoalRunState {
  const next: GoalRunState = {
    ...state,
    events: [...state.events, event].slice(-400),
    liveText: state.liveText,
  };
  if (event.type === "run.start") {
    next.runId = event.runId;
    next.active = true;
    next.executorId = event.executorId;
    next.liveText = "";
  }
  if (event.type === "text.delta") {
    next.liveText = (state.liveText + event.delta).slice(-8000);
  }
  if (event.type === "run.end") {
    next.active = false;
  }
  return next;
}

export function applyRunDelta(state: GoalRunState, event: RunDeltaEvent): GoalRunState {
  return applyRunStreamEvent(state, event as RunStreamEvent);
}
