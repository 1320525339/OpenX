import type {
  CoachMessageRecord,
  Goal,
  GoalRunState,
  RefinedGoal,
} from "@openx/shared";
import { createEmptyRunState, findDismissedRefinedRecordIds } from "@openx/shared";

export type ChatTextMessage = {
  id?: number;
  role: "user" | "coach";
  text: string;
  warn?: boolean;
};

export type ExecutionPin = {
  goalId: string;
  goalTitle: string;
  goalStatus: Goal["status"];
  runId: string;
  run: GoalRunState;
  endedAt: string;
};

export type ChatThreadItem =
  | { kind: "message"; key: string; message: ChatTextMessage }
  | { kind: "execution"; key: string; pin: ExecutionPin }
  | {
      kind: "refined";
      key: string;
      recordId: number;
      refined: import("@openx/shared").RefinedGoal;
      linkedGoalId?: string;
    };

export function coachRecordsToThreadItems(
  records: CoachMessageRecord[],
): ChatThreadItem[] {
  const items: ChatThreadItem[] = [];
  for (const record of records) {
    if (record.kind === "tool_result") continue;
    if (record.kind === "text") {
      items.push({
        kind: "message",
        key: `msg-${record.id}`,
        message: {
          id: record.id,
          role: record.role,
          text: record.text,
        },
      });
      continue;
    }
    if (record.kind === "execution") {
      items.push({
        kind: "execution",
        key: `exec-${record.id}`,
        pin: {
          goalId: record.execution.goalId,
          goalTitle: record.execution.goalTitle,
          goalStatus: record.execution.goalStatus,
          runId: record.execution.runId,
          run: record.execution.run,
          endedAt: record.timestamp,
        },
      });
      continue;
    }
    if (record.kind === "refined") {
      items.push({
        kind: "refined",
        key: `refined-${record.id}`,
        recordId: record.id,
        refined: record.refined,
        linkedGoalId: record.linkedGoalId,
      });
    }
  }
  return items;
}

export function pickLiveExecution(
  goals: Goal[],
  runs: Record<string, GoalRunState>,
  selectedGoal?: Goal,
): { goal: Goal; run: GoalRunState } | null {
  const ordered: Goal[] = [];
  if (
    selectedGoal &&
    (selectedGoal.status === "running" || selectedGoal.status === "awaiting_review")
  ) {
    ordered.push(selectedGoal);
  }
  for (const g of goals) {
    if (g.status === "running" && g.id !== selectedGoal?.id) ordered.push(g);
  }

  for (const goal of ordered) {
    const run = runs[goal.id] ?? createEmptyRunState(goal.id);
    if (run.active) {
      return { goal, run };
    }
  }
  return null;
}

export function appendCoachRecord(
  records: CoachMessageRecord[],
  message: ChatTextMessage,
  conversationId: string,
): CoachMessageRecord[] {
  if (
    message.id != null &&
    records.some((r) => r.kind === "text" && r.id === message.id)
  ) {
    return records;
  }
  if (
    records.some(
      (r) => r.kind === "text" && r.role === "coach" && r.text === message.text,
    )
  ) {
    return records;
  }
  const nextId = message.id ?? -(records.length + 1);
  return [
    ...records,
    {
      id: nextId,
      conversationId,
      kind: "text",
      role: message.role,
      text: message.text,
      timestamp: new Date().toISOString(),
    },
  ];
}

export function appendExecutionRecord(
  records: CoachMessageRecord[],
  message: Extract<CoachMessageRecord, { kind: "execution" }>,
): CoachMessageRecord[] {
  if (records.some((r) => r.kind === "execution" && r.id === message.id)) {
    return records;
  }
  return [...records, message];
}

export function appendRefinedRecord(
  records: CoachMessageRecord[],
  message: Extract<CoachMessageRecord, { kind: "refined" }>,
): CoachMessageRecord[] {
  if (records.some((r) => r.kind === "refined" && r.id === message.id)) {
    return records;
  }
  return [...records, message];
}

function refinedMatchesExistingGoal(refined: RefinedGoal, goals: Goal[]): boolean {
  return goals.some(
    (g) => g.title === refined.title && g.acceptance === refined.acceptance,
  );
}

/** 判断 persisted refined 记录是否与当前编辑中的预览为同一张任务单 */
export function refinedRecordMatchesPreview(
  record: Extract<CoachMessageRecord, { kind: "refined" }>,
  preview: RefinedGoal,
): boolean {
  return (
    record.refined.title === preview.title &&
    record.refined.executionPrompt === preview.executionPrompt
  );
}

/** 当前预览对应的 refined 记录 id；无匹配记录时返回 null（等待 SSE/同步） */
export function findActiveRefinedRecordId(
  records: CoachMessageRecord[],
  preview: RefinedGoal,
  explicitId?: number | null,
): number | null {
  if (explicitId != null) {
    const row = records.find((r) => r.kind === "refined" && r.id === explicitId);
    if (row?.kind === "refined" && !row.linkedGoalId) return explicitId;
  }
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const row = records[i];
    if (row?.kind !== "refined" || row.linkedGoalId) continue;
    if (refinedRecordMatchesPreview(row, preview)) return row.id;
  }
  return null;
}

/** 最近一条尚未创建目标的工单预览（已关联 goal 或已有同标题验收目标则跳过） */
export function findLatestPendingRefinedRecord(
  records: CoachMessageRecord[],
  goals: Goal[] = [],
  skipRecordIds: ReadonlySet<number> = new Set(),
): Extract<CoachMessageRecord, { kind: "refined" }> | null {
  const dismissed = findDismissedRefinedRecordIds(records);
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const row = records[i];
    if (row?.kind !== "refined") continue;
    if (skipRecordIds.has(row.id) || dismissed.has(row.id)) continue;
    if (row.linkedGoalId) continue;
    if (refinedMatchesExistingGoal(row.refined, goals)) continue;
    return row;
  }
  return null;
}

/** @deprecated 使用 findLatestPendingRefinedRecord */
export function findLatestRefinedRecord(
  records: CoachMessageRecord[],
): Extract<CoachMessageRecord, { kind: "refined" }> | null {
  return findLatestPendingRefinedRecord(records);
}
