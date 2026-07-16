import { z } from "zod";
import type { GoalAccessActor } from "./goal-access.js";

export const TaskCommandTypeSchema = z.enum([
  "publish",
  "pause",
  "resume",
  "cancel",
  "approve",
  "rework",
]);
export type TaskCommandType = z.infer<typeof TaskCommandTypeSchema>;

export const TaskCommandSourceSchema = z.enum([
  "ui",
  "chat_slash",
  "island",
  "api",
  "system",
  "auto_policy",
]);
export type TaskCommandSource = z.infer<typeof TaskCommandSourceSchema>;

/** HTTP 入参（actor 由服务端从请求头解析，不信任客户端 body） */
export const TaskCommandHttpBodySchema = z.object({
  type: TaskCommandTypeSchema,
  reason: z.string().optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
  userDecision: z.string().optional(),
  reworkReason: z.string().optional(),
});
export type TaskCommandHttpBody = z.infer<typeof TaskCommandHttpBodySchema>;

export type TaskCommand = {
  type: TaskCommandType;
  goalId: string;
  source: TaskCommandSource;
  actor: GoalAccessActor;
  reason?: string;
  idempotencyKey?: string;
  userDecision?: string;
  reworkReason?: string;
};

export function isPrivilegedTaskSource(source: TaskCommandSource): boolean {
  return source === "system" || source === "auto_policy";
}
