/** 集成自动化运行记录（与用户 Goal 分流） */
export type IntegrationRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "needs_attention"
  | "cancelled"
  | "accepted";

export type IntegrationRun = {
  id: string;
  integrationId: string;
  lane: string;
  /** 合并键：同 sourceKey 在冷却窗口内合并 */
  sourceKey?: string;
  traceId: string;
  idempotencyKey: string;
  status: IntegrationRunStatus;
  title: string;
  summary?: string;
  goalId?: string;
  inputJson?: string;
  resultJson?: string;
  payloadJson?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  updatedAt: string;
  finishedAt?: string;
};

/** 可复用执行工作项：Goal 与 IntegrationRun 共用执行入口 */
export type ExecutionWorkItem = {
  id: string;
  kind: "goal" | "integration_run";
  integrationId?: string;
  title: string;
  executionPrompt: string;
  skillIds: string[];
  permissionMode: "read_only" | "ask_write" | "full";
  conversationId?: string;
  timeoutMs?: number;
};

export function mapIntegrationRunToTraceStatus(
  status: IntegrationRunStatus,
): "done" | "in_progress" | "unknown" {
  // needs_attention：默认仍在等待（关联 Goal 终态由 get_trace 另行判断）
  if (status === "needs_attention") return "in_progress";
  if (status === "succeeded") return "done";
  if (status === "failed" || status === "cancelled") return "unknown";
  if (status === "queued" || status === "running" || status === "accepted") {
    return "in_progress";
  }
  return "unknown";
}

/**
 * 结合关联 Goal 终态解析 trace。
 * needs_attention + Goal 仍执行中 → in_progress；
 * Goal 已 awaiting_review/done → done；failed/cancelled → unknown。
 */
export function resolveIntegrationRunTraceStatus(
  status: IntegrationRunStatus,
  goalStatus?: string | null,
): "done" | "in_progress" | "unknown" {
  if (status === "needs_attention") {
    if (!goalStatus) return "in_progress";
    if (goalStatus === "awaiting_review" || goalStatus === "done") return "done";
    if (goalStatus === "failed" || goalStatus === "cancelled") return "unknown";
    return "in_progress";
  }
  return mapIntegrationRunToTraceStatus(status);
}

export function mapIntegrationRunToTurnStatus(
  status: IntegrationRunStatus,
): "ok" | "error" | "timeout" {
  if (status === "succeeded" || status === "needs_attention") return "ok";
  if (status === "failed" || status === "cancelled") return "error";
  return "timeout";
}
