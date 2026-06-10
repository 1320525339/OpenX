import { z } from "zod";

export const EXECUTOR_PI = "pi" as const;
export const EXECUTOR_AUTO = "auto" as const;

/** 预设 ACP CLI runtime，goal.executorId 形如 acp:gemini */
export const ACP_RUNTIMES = {
  "acp:gemini": {
    command: "gemini",
    args: ["--acp"],
    label: "Gemini CLI (ACP)",
  },
  "acp:codex": {
    command: "codex",
    args: ["acp"],
    label: "Codex CLI (ACP)",
  },
  "acp:claude": {
    command: "claude",
    args: ["--acp"],
    label: "Claude Code (ACP)",
  },
} as const;

export type AcpRuntimeId = keyof typeof ACP_RUNTIMES;

const CONNECT_EXECUTOR_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/i;

export function isAcpExecutorId(id: string): boolean {
  return id.startsWith("acp:") && id.length > 4;
}

export function parseAcpRuntimeId(id: string): AcpRuntimeId | null {
  if (id in ACP_RUNTIMES) return id as AcpRuntimeId;
  return null;
}

export function isAutoExecutorId(id: string): boolean {
  return id === EXECUTOR_AUTO;
}

export function isBuiltinExecutorId(id: string): boolean {
  return id === EXECUTOR_PI || isAutoExecutorId(id) || isAcpExecutorId(id);
}

/** Connect Agent 注册的自定义 executorId（非 pi / acp:*） */
export function isConnectExecutorId(id: string): boolean {
  return !isBuiltinExecutorId(id) && CONNECT_EXECUTOR_ID_PATTERN.test(id);
}

export const ExecutorIdSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(
    (id) =>
      id === EXECUTOR_AUTO ||
      id === EXECUTOR_PI ||
      isAcpExecutorId(id) ||
      CONNECT_EXECUTOR_ID_PATTERN.test(id),
    { message: "invalid executorId" },
  );

export type ExecutorId = z.infer<typeof ExecutorIdSchema>;

export function isValidExecutorId(id: string): id is ExecutorId {
  return ExecutorIdSchema.safeParse(id).success;
}
