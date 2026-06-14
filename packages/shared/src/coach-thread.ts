import { CLARIFY_TOOL_NAME } from "./coach-clarify.js";
import type { CoachMessageRecord } from "./coach-messages.js";
import {
  WORK_ORDER_TOOL_NAME,
  type CoachToolResultPayload,
  type WorkOrderToolResult,
} from "./coach-messages.js";
import type { CoachChatTurn } from "./coach.js";
import { isWorkOrderDismissMessage } from "./coach-intent.js";

/** 工头/审查共用会话前缀默认条数 */
export const DEFAULT_COACH_THREAD_MESSAGE_LIMIT = 24;

export type CoachRecordsToChatTurnsOptions = {
  /** 审查等场景：纳入执行快照行 */
  includeExecutionSnapshots?: boolean;
  /** 审查等场景：纳入操作待确认行 */
  includeOperatorActions?: boolean;
};

function formatRefinedToolUse(
  record: Extract<CoachMessageRecord, { kind: "refined" }>,
): string {
  const { refined, id } = record;
  return `[工具调用 ${WORK_ORDER_TOOL_NAME} #${id}] ${JSON.stringify({
    title: refined.title,
    acceptance: refined.acceptance,
    executionPrompt: refined.executionPrompt,
    constraints: refined.constraints,
    executorId: refined.executorId,
    priority: refined.priority,
    subGoals: refined.subGoals,
  })}`;
}

function formatClarifyToolUse(
  record: Extract<CoachMessageRecord, { kind: "clarify" }>,
): string {
  const { clarify, id } = record;
  return `[工具调用 ${CLARIFY_TOOL_NAME} #${id}] ${JSON.stringify({
    title: clarify.title,
    introHtml: clarify.introHtml,
    questionCount: clarify.questions.length,
    questions: clarify.questions.map((q) => ({
      id: q.id,
      prompt: q.prompt,
      multiSelect: q.multiSelect,
      allowFreeform: q.allowFreeform,
      dependsOnIndex: q.dependsOnIndex,
      dependsOnOptionIds: q.dependsOnOptionIds,
      options: q.options?.map((o) => ({
        id: o.id,
        label: o.label,
        description: o.description,
        recommended: o.recommended,
      })),
    })),
  })}`;
}

function formatWorkOrderToolResult(result: WorkOrderToolResult): string {
  return JSON.stringify({
    tool: result.toolName,
    refinedMessageId: result.refinedMessageId,
    outcome: result.outcome,
    title: result.title,
    dismissed: result.outcome === "dismissed",
    goalId: result.goalId,
  });
}

function formatClarifyToolResult(
  result: Extract<CoachToolResultPayload, { toolName: typeof CLARIFY_TOOL_NAME }>,
): string {
  return JSON.stringify({
    tool: result.toolName,
    clarifyMessageId: result.clarifyMessageId,
    outcome: result.outcome,
    answers: result.answers,
    annotations: result.annotations,
    dismissed: result.outcome === "dismissed",
  });
}

function formatCoachToolResult(result: CoachToolResultPayload): string {
  if (result.toolName === CLARIFY_TOOL_NAME) {
    return formatClarifyToolResult(result);
  }
  return formatWorkOrderToolResult(result);
}

/** 将持久化线程转为 LLM 多轮历史（含 propose_work_order 与 tool_result） */
export function coachRecordsToChatTurns(
  records: CoachMessageRecord[],
  options?: CoachRecordsToChatTurnsOptions,
): CoachChatTurn[] {
  const turns: CoachChatTurn[] = [];
  for (const row of records) {
    if (row.kind === "text") {
      turns.push({ role: row.role, text: row.text });
      continue;
    }
    if (row.kind === "execution" && options?.includeExecutionSnapshots) {
      turns.push({
        role: "coach",
        text: `[执行快照] ${row.execution.goalTitle} · ${row.execution.goalStatus}`,
      });
      continue;
    }
    if (row.kind === "refined") {
      turns.push({
        role: "coach",
        text: formatRefinedToolUse(row),
        toolName: WORK_ORDER_TOOL_NAME,
      });
      continue;
    }
    if (row.kind === "clarify") {
      turns.push({
        role: "coach",
        text: formatClarifyToolUse(row),
        toolName: CLARIFY_TOOL_NAME,
      });
      continue;
    }
    if (row.kind === "tool_result") {
      turns.push({
        role: "tool_result",
        toolName: row.toolResult.toolName,
        text: formatCoachToolResult(row.toolResult),
      });
      continue;
    }
    if (row.kind === "operator_action" && options?.includeOperatorActions) {
      turns.push({
        role: "coach",
        text: `[操作待确认] ${row.operatorAction.summary}`,
      });
    }
  }
  return turns;
}

/** 用户已跳过澄清的记录 id */
export function findDismissedClarifyRecordIds(
  records: CoachMessageRecord[],
): Set<number> {
  const dismissed = new Set<number>();
  for (const row of records) {
    if (
      row.kind === "tool_result" &&
      row.toolResult.toolName === CLARIFY_TOOL_NAME &&
      row.toolResult.outcome === "dismissed"
    ) {
      dismissed.add(row.toolResult.clarifyMessageId);
    }
  }
  return dismissed;
}

/** 仍待用户回答的澄清记录 id */
export function findPendingClarifyRecordIds(
  records: CoachMessageRecord[],
): number[] {
  const resolved = findResolvedClarifyRecordIds(records);
  const pending: number[] = [];
  for (const row of records) {
    if (row.kind !== "clarify") continue;
    if (resolved.has(row.id)) continue;
    if (row.clarify.status === "answered" || row.clarify.status === "dismissed") {
      continue;
    }
    pending.push(row.id);
  }
  return pending;
}

/** 已有 tool_result 的澄清记录 id（含已回答与已跳过） */
export function findResolvedClarifyRecordIds(
  records: CoachMessageRecord[],
): Set<number> {
  const resolved = new Set<number>();
  for (const row of records) {
    if (
      row.kind === "tool_result" &&
      row.toolResult.toolName === CLARIFY_TOOL_NAME
    ) {
      resolved.add(row.toolResult.clarifyMessageId);
    }
  }
  return resolved;
}

/** 用户已取消、且该 refined 尚未关联 goal 的记录 id */
export function findDismissedRefinedRecordIds(
  records: CoachMessageRecord[],
): Set<number> {
  const dismissed = new Set<number>();
  for (const row of records) {
    if (
      row.kind === "tool_result" &&
      row.toolResult.toolName === WORK_ORDER_TOOL_NAME &&
      row.toolResult.outcome === "dismissed"
    ) {
      dismissed.add(row.toolResult.refinedMessageId);
    }
  }
  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    if (row?.kind !== "refined" || row.linkedGoalId || dismissed.has(row.id)) {
      continue;
    }
    for (let j = i + 1; j < records.length; j++) {
      const later = records[j];
      if (
        later?.kind === "text" &&
        later.role === "user" &&
        isWorkOrderDismissMessage(later.text)
      ) {
        dismissed.add(row.id);
        break;
      }
    }
  }
  return dismissed;
}
