import { z } from "zod";

export const ConnectInputSchema = z.object({
  toolName: z.string().min(1),
  agentName: z.string().min(1),
  /** 与 Goal.executorId 对齐，默认与 toolName 相同 */
  executorId: z.string().optional(),
});
export type ConnectInput = z.infer<typeof ConnectInputSchema>;

export const HeartbeatInputSchema = z.object({
  connectionId: z.string().min(1).optional(),
  tokenUsage: z
    .object({
      model: z.string().optional(),
      inputTokens: z.number().optional(),
      outputTokens: z.number().optional(),
    })
    .optional(),
});
export type HeartbeatInput = z.infer<typeof HeartbeatInputSchema>;

export type AgentConnection = {
  connectionId: string;
  toolName: string;
  agentName: string;
  executorId: string;
  connectedAt: string;
  lastHeartbeatAt: string;
};
