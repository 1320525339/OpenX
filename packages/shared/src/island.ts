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

export const IslandDurabilitySchema = z.enum(["transient", "durable"]);
export type IslandDurability = z.infer<typeof IslandDurabilitySchema>;

const DURABLE_KINDS = new Set<IslandPayloadKind>([
  "goal.awaiting_review",
  "goal.review_limit",
  "goal.review_unavailable",
  "goal.review_fail",
  "goal.failed",
  "goal.gate_blocked",
]);

/** kind → durability；调用方勿自行猜测 */
export function islandDurabilityForKind(kind: IslandPayloadKind): IslandDurability {
  return DURABLE_KINDS.has(kind) ? "durable" : "transient";
}

export function isDurableIslandKind(kind: IslandPayloadKind): boolean {
  return islandDurabilityForKind(kind) === "durable";
}

const BoundedId = z.string().min(1).max(128);
const BoundedTitle = z.string().min(1).max(120);
const BoundedMessage = z.string().min(1).max(2000);
const BoundedFeedback = z.string().max(2000);

/** 卡片按钮触发的动作 */
export const IslandActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("dismiss") }),
  z.object({ type: z.literal("navigate"), goalId: BoundedId }),
  z.object({ type: z.literal("approve"), goalId: BoundedId }),
  z.object({
    type: z.literal("rework"),
    goalId: BoundedId,
    reason: BoundedFeedback.optional(),
  }),
  z.object({ type: z.literal("retry"), goalId: BoundedId }),
  z.object({ type: z.literal("trigger_review"), goalId: BoundedId }),
]);
export type IslandAction = z.infer<typeof IslandActionSchema>;

export const IslandActionButtonSchema = z.object({
  id: BoundedId,
  label: z.string().min(1).max(40),
  variant: z.enum(["primary", "default", "danger", "ghost"]).default("default"),
  action: IslandActionSchema,
});
export type IslandActionButton = z.infer<typeof IslandActionButtonSchema>;

const IslandMetaSchema = z
  .object({
    status: GoalStatusSchema.optional(),
    iterationCount: z.number().int().optional(),
    maxIterations: z.number().int().optional(),
    reworkInstruction: BoundedFeedback.optional(),
    reviewReason: BoundedFeedback.optional(),
    resultPreview: BoundedFeedback.optional(),
    deliverables: z.array(GoalDeliverableSchema).max(50).optional(),
    gateReasons: z
      .array(
        z.object({
          code: z.enum([
            "child_not_complete",
            "pending_clarify",
            "auto_review_required",
          ]),
          message: BoundedMessage,
        }),
      )
      .max(20)
      .optional(),
  })
  .strict()
  .optional();

export const DynamicIslandPayloadSchema = z
  .object({
    id: BoundedId,
    kind: IslandPayloadKindSchema,
    severity: IslandSeveritySchema.default("info"),
    title: BoundedTitle,
    message: BoundedMessage,
    goalId: BoundedId.optional(),
    expanded: z.boolean().optional(),
    autoDismissMs: z.number().int().min(0).max(120_000).optional(),
    allowFeedback: z.boolean().optional(),
    feedbackPlaceholder: z.string().max(120).optional(),
    meta: IslandMetaSchema,
    actions: z.array(IslandActionButtonSchema).max(8).optional(),
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (payload.kind.startsWith("goal.") && !payload.goalId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "goal.* kind 必须提供 goalId",
        path: ["goalId"],
      });
    }
    for (const [i, btn] of (payload.actions ?? []).entries()) {
      const action = btn.action;
      if ("goalId" in action && payload.goalId && action.goalId !== payload.goalId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "action.goalId 必须与 payload.goalId 一致",
          path: ["actions", i, "action", "goalId"],
        });
      }
    }
  });
export type DynamicIslandPayload = z.infer<typeof DynamicIslandPayloadSchema>;

/** 目标类 push：只接受 goalId + eventType，由服务端生成正文 */
export const IslandPushGoalRequestSchema = z
  .object({
    goalId: BoundedId,
    eventType: z.enum([
      "awaiting_review",
      "review_limit",
      "review_blocked",
      "review_unavailable",
      "failed",
      "gate_blocked",
    ]),
    reason: BoundedFeedback.optional(),
    iteration: z.number().int().nonnegative().optional(),
  })
  .strict();
export type IslandPushGoalRequest = z.infer<typeof IslandPushGoalRequestSchema>;

/** 受限 broadcast（无 approve/rework） */
export const IslandPushBroadcastRequestSchema = z
  .object({
    kind: z.literal("broadcast"),
    id: BoundedId,
    title: BoundedTitle,
    message: BoundedMessage,
    severity: IslandSeveritySchema.optional(),
    goalId: BoundedId.optional(),
    autoDismissMs: z.number().int().min(0).max(120_000).optional(),
  })
  .strict();
export type IslandPushBroadcastRequest = z.infer<typeof IslandPushBroadcastRequestSchema>;

export const MarkIslandSeenRequestSchema = z.object({
  ids: z.array(BoundedId).min(1).max(100),
  scopeKey: z.string().min(1).max(160).optional(),
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

