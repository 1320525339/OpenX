import { z } from "zod";
import { DispatchPermissionModeSchema } from "./dispatch-context.js";

export const DISPATCH_PERMISSION_TOOL_NAME = "propose_dispatch_permission" as const;

export const CoachDispatchPermissionStatusSchema = z.enum([
  "pending",
  "confirmed",
  "dismissed",
]);
export type CoachDispatchPermissionStatus = z.infer<
  typeof CoachDispatchPermissionStatusSchema
>;

export const CoachDispatchPermissionPayloadSchema = z.object({
  requestedMode: DispatchPermissionModeSchema,
  reason: z.string().optional(),
  status: CoachDispatchPermissionStatusSchema.default("pending"),
});
export type CoachDispatchPermissionPayload = z.infer<
  typeof CoachDispatchPermissionPayloadSchema
>;

export const DispatchPermissionToolOutcomeSchema = z.enum(["confirmed", "dismissed"]);
export type DispatchPermissionToolOutcome = z.infer<
  typeof DispatchPermissionToolOutcomeSchema
>;

export const DispatchPermissionToolResultSchema = z.object({
  toolName: z.literal(DISPATCH_PERMISSION_TOOL_NAME),
  dispatchPermissionMessageId: z.number(),
  outcome: DispatchPermissionToolOutcomeSchema,
  requestedMode: DispatchPermissionModeSchema,
  appliedMode: DispatchPermissionModeSchema.optional(),
  reason: z.string().optional(),
});
export type DispatchPermissionToolResult = z.infer<
  typeof DispatchPermissionToolResultSchema
>;

export const DispatchPermissionRespondSchema = z.object({
  conversationId: z.string().min(1),
  outcome: DispatchPermissionToolOutcomeSchema,
});
export type DispatchPermissionRespondInput = z.infer<
  typeof DispatchPermissionRespondSchema
>;
