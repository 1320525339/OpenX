import { z } from "zod";
import { GoalDeliverableSchema } from "./deliverable.js";
import { GoalStatusSchema } from "./goal.js";

/** 灵动岛严重级别（视觉） */
export const IslandSeveritySchema = z.enum(["success", "warning", "info", "error"]);
export type IslandSeverity = z.infer<typeof IslandSeveritySchema>;

/** 灵动岛卡片类型（内外部统一协议） */
export const IslandPayloadKindSchema = z.enum([
  "goal.awaiting_review",
  "goal.review_limit",
  "goal.review_unavailable",
  "goal.review_fail",
  "goal.done",
  "goal.failed",
  "goal.rework",
  "goal.running",
  "goal.gate_blocked",
  "broadcast",
]);
export type IslandPayloadKind = z.infer<typeof IslandPayloadKindSchema>;

/** 卡片按钮触发的动作 */
export const IslandActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("dismiss") }),
  z.object({ type: z.literal("navigate"), goalId: z.string() }),
  z.object({ type: z.literal("approve"), goalId: z.string() }),
  z.object({
    type: z.literal("rework"),
    goalId: z.string(),
    reason: z.string().optional(),
  }),
  z.object({ type: z.literal("retry"), goalId: z.string() }),
  z.object({ type: z.literal("trigger_review"), goalId: z.string() }),
]);
export type IslandAction = z.infer<typeof IslandActionSchema>;

export const IslandActionButtonSchema = z.object({
  id: z.string(),
  label: z.string(),
  variant: z.enum(["primary", "default", "danger", "ghost"]).default("default"),
  action: IslandActionSchema,
});
export type IslandActionButton = z.infer<typeof IslandActionButtonSchema>;

export const DynamicIslandPayloadSchema = z.object({
  id: z.string(),
  kind: IslandPayloadKindSchema,
  severity: IslandSeveritySchema.default("info"),
  title: z.string(),
  message: z.string(),
  goalId: z.string().optional(),
  expanded: z.boolean().optional(),
  autoDismissMs: z.number().optional(),
  /** 展开后展示反馈输入框（审查/返工） */
  allowFeedback: z.boolean().optional(),
  feedbackPlaceholder: z.string().optional(),
  meta: z
    .object({
      status: GoalStatusSchema.optional(),
      iterationCount: z.number().int().optional(),
      maxIterations: z.number().int().optional(),
      reworkInstruction: z.string().optional(),
      reviewReason: z.string().optional(),
      resultPreview: z.string().optional(),
      deliverables: z.array(GoalDeliverableSchema).optional(),
      gateReasons: z
        .array(
          z.object({
            code: z.enum([
              "child_not_complete",
              "pending_clarify",
              "auto_review_required",
            ]),
            message: z.string(),
          }),
        )
        .optional(),
    })
    .optional(),
  actions: z.array(IslandActionButtonSchema).optional(),
});
export type DynamicIslandPayload = z.infer<typeof DynamicIslandPayloadSchema>;

export const MarkIslandSeenRequestSchema = z.object({
  ids: z.array(z.string()).min(1).max(100),
});
export type MarkIslandSeenRequest = z.infer<typeof MarkIslandSeenRequestSchema>;

export const IslandSeenListResponseSchema = z.object({
  seenIds: z.array(z.string()),
});
export type IslandSeenListResponse = z.infer<typeof IslandSeenListResponseSchema>;

export const MarkIslandSeenResponseSchema = z.object({
  ok: z.literal(true),
  marked: z.number().int().nonnegative(),
});
export type MarkIslandSeenResponse = z.infer<typeof MarkIslandSeenResponseSchema>;

/** 通用「关闭」按钮，供持久型灵动岛（autoDismissMs=0）使用 */
export const ISLAND_DISMISS_ACTION: IslandActionButton = {
  id: "dismiss",
  label: "知道了",
  variant: "ghost",
  action: { type: "dismiss" },
};

/** 若 actions 中尚无 dismiss，则追加「知道了」 */
export function withIslandDismissAction(
  payload: DynamicIslandPayload,
): DynamicIslandPayload {
  const actions = payload.actions ?? [];
  if (actions.some((a) => a.action.type === "dismiss")) return payload;
  return { ...payload, actions: [...actions, ISLAND_DISMISS_ACTION] };
}

/** 同一 goal + kind 的卡片去重键（避免队列堆叠同类通知） */
export function islandDedupeKey(payload: DynamicIslandPayload): string | null {
  if (!payload.goalId || !payload.kind.startsWith("goal.")) return null;
  return `${payload.kind}:${payload.goalId}`;
}
