import type { CoachMessageRecord } from "./coach-messages.js";
import {
  WORK_ORDER_TOOL_NAME,
  type WorkOrderToolResult,
} from "./coach-messages.js";
import type { CoachChatTurn } from "./coach.js";
import { isWorkOrderDismissMessage } from "./coach-intent.js";

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

/** 将持久化线程转为 LLM 多轮历史（含 propose_work_order 与 tool_result） */
export function coachRecordsToChatTurns(
  records: CoachMessageRecord[],
): CoachChatTurn[] {
  const turns: CoachChatTurn[] = [];
  for (const row of records) {
    if (row.kind === "text") {
      turns.push({ role: row.role, text: row.text });
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
    if (row.kind === "tool_result") {
      turns.push({
        role: "tool_result",
        toolName: row.toolResult.toolName,
        text: formatWorkOrderToolResult(row.toolResult),
      });
    }
  }
  return turns;
}

/** 用户已取消、且该 refined 尚未关联 goal 的记录 id */
export function findDismissedRefinedRecordIds(
  records: CoachMessageRecord[],
): Set<number> {
  const dismissed = new Set<number>();
  for (const row of records) {
    if (row.kind === "tool_result" && row.toolResult.outcome === "dismissed") {
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
