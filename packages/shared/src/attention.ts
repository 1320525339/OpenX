import { z } from "zod";
import {
  IslandPayloadKindSchema,
  IslandSeveritySchema,
  type DynamicIslandPayload,
} from "./island.js";

export const AttentionStateSchema = z.enum(["open", "acknowledged", "resolved"]);
export type AttentionState = z.infer<typeof AttentionStateSchema>;

export const AttentionAudienceSchema = z.enum(["global", "user", "device"]);
export type AttentionAudience = z.infer<typeof AttentionAudienceSchema>;

export const AttentionScopeSchema = z.object({
  audience: AttentionAudienceSchema.default("global"),
  userId: z.string().max(128).optional(),
  deviceId: z.string().max(128).optional(),
});
export type AttentionScope = z.infer<typeof AttentionScopeSchema>;

export const AttentionRecordSchema = z.object({
  key: z.string().min(1).max(256),
  kind: IslandPayloadKindSchema,
  goalId: z.string().max(128).optional(),
  severity: IslandSeveritySchema,
  state: AttentionStateSchema,
  revision: z.number().int().positive(),
  title: z.string().max(120),
  message: z.string().max(2000),
  scope: AttentionScopeSchema,
  expiresAt: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** 服务端生成的展示投影；客户端可直接入队 */
  payload: z.unknown().optional(),
});
export type AttentionRecord = z.infer<typeof AttentionRecordSchema>;

export const AttentionListResponseSchema = z.object({
  attentions: z.array(AttentionRecordSchema),
});
export type AttentionListResponse = z.infer<typeof AttentionListResponseSchema>;

export const AttentionAckResponseSchema = z.object({
  ok: z.literal(true),
  key: z.string(),
  state: AttentionStateSchema,
  revision: z.number().int().positive(),
});
export type AttentionAckResponse = z.infer<typeof AttentionAckResponseSchema>;

/** 稳定 attention key：goal 类用 kind:goalId，否则用 payload.id */
export function attentionKeyForPayload(payload: DynamicIslandPayload): string {
  if (payload.goalId && payload.kind.startsWith("goal.")) {
    return `${payload.kind}:${payload.goalId}`;
  }
  return payload.id;
}

const SEVERITY_RANK: Record<string, number> = {
  error: 0,
  warning: 1,
  info: 2,
  success: 3,
};

export function islandSeverityRank(severity: string | undefined): number {
  return SEVERITY_RANK[severity ?? "info"] ?? 2;
}
