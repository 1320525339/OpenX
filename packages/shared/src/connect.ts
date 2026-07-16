import { z } from "zod";
import { GoalSchema } from "./goal.js";

export const ConnectInputSchema = z.object({
  toolName: z.string().min(1),
  agentName: z.string().min(1),
  /** 与 Goal.executorId 对齐，默认与 toolName 相同 */
  executorId: z.string().optional(),
});
export type ConnectInput = z.infer<typeof ConnectInputSchema>;

export const ClaimPoolGoalSchema = z.object({
  goalId: z.string().optional(),
});
export type ClaimPoolGoalInput = z.infer<typeof ClaimPoolGoalSchema>;

export const HeartbeatInputSchema = z.object({
  connectionId: z.string().min(1).optional(),
  /** 心跳时从任务池原子认领一条 connect:any（默认 true，每次最多 1 条） */
  autoClaimPool: z.boolean().optional(),
  tokenUsage: z
    .object({
      model: z.string().optional(),
      inputTokens: z.number().optional(),
      outputTokens: z.number().optional(),
      goalId: z.string().optional(),
      runId: z.string().optional(),
    })
    .optional(),
});
export type HeartbeatInput = z.infer<typeof HeartbeatInputSchema>;

/** 心跳返回的待办：Goal + 派单凭证绑定 */
export const PendingGoalWorkItemSchema = z.object({
  goal: GoalSchema,
  receiptId: z.string().optional(),
  runId: z.string().optional(),
});
export type PendingGoalWorkItem = z.infer<typeof PendingGoalWorkItemSchema>;

export const AckDispatchReceiptSchema = z.object({
  receiptId: z.string().min(1),
});
export type AckDispatchReceiptInput = z.infer<typeof AckDispatchReceiptSchema>;

export type AgentConnection = {
  connectionId: string;
  toolName: string;
  agentName: string;
  executorId: string;
  connectedAt: string;
  lastHeartbeatAt: string;
};
