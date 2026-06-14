import type {
  CoachMessageRecord,
  Goal,
  GoalRunState,
  RefinedGoal,
} from "@openx/shared";
import {
  createEmptyRunState,
  findDismissedClarifyRecordIds,
  findDismissedRefinedRecordIds,
  findResolvedClarifyRecordIds,
} from "@openx/shared";

export type ChatTextMessage = {
  id?: number;
  role: "user" | "coach";
  text: string;
  warn?: boolean;
  timestamp?: string;
};

export type CrewExchangeDisplay = {
  direction: "crew_to_foreman" | "foreman_to_crew" | "foreman_escalation" | "foreman_review";
  label: string;
  summary: string;
};

const CREW_EXCHANGE_LINE_RE =
  /^\[(施工队 → 工头|工头 → 施工队|工头 → 开发商|工头验收)\]\s*([\s\S]*)$/;

/** 解析工头线程里持久化的 crew 对话行（见 formatCrewExchangeCoachLine） */
export function parseCrewExchangeCoachText(text: string): CrewExchangeDisplay | null {
  const m = text.trim().match(CREW_EXCHANGE_LINE_RE);
  if (!m) return null;
  const label = m[1]!;
  const summary = m[2]!.trim();
  const direction =
    label === "施工队 → 工头"
      ? "crew_to_foreman"
      : label === "工头 → 施工队"
        ? "foreman_to_crew"
        : label === "工头 → 开发商"
          ? "foreman_escalation"
          : "foreman_review";
  return { direction, label, summary };
}

function formatChatDateSeparatorLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "对话";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTarget = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round(
    (startOfToday.getTime() - startOfTarget.getTime()) / 86_400_000,
  );
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (dayDiff === 0) return `今天 ${time}`;
  if (dayDiff === 1) return `昨天 ${time}`;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function itemTimestamp(
  item: ChatThreadItem,
  recordTsByKey: Map<string, string>,
): string | undefined {
  if (item.kind === "message") return item.message.timestamp;
  if (item.kind === "crew_exchange") return item.timestamp;
  if (item.kind === "execution") return item.pin.endedAt;
  return recordTsByKey.get(item.key);
}

/** Hermes 式时间分隔：在相邻消息跨天时插入日期条 */
export function injectChatDateSeparators(
  items: ChatThreadItem[],
  recordTsByKey: Map<string, string>,
): ChatThreadItem[] {
  const out: ChatThreadItem[] = [];
  let lastDayKey = "";
  for (const item of items) {
    const ts = itemTimestamp(item, recordTsByKey);
    if (ts) {
      const d = new Date(ts);
      if (!Number.isNaN(d.getTime())) {
        const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        if (dayKey !== lastDayKey) {
          out.push({
            kind: "date_separator",
            key: `date-${dayKey}-${item.key}`,
            label: formatChatDateSeparatorLabel(ts),
          });
          lastDayKey = dayKey;
        }
      }
    }
    out.push(item);
  }
  return out;
}

export function buildDisplayThreadItems(records: CoachMessageRecord[]): ChatThreadItem[] {
  const tsByKey = new Map<string, string>();
  const base = coachRecordsToThreadItems(records);
  for (const record of records) {
    if (record.kind === "tool_result") continue;
    if (record.kind === "text") tsByKey.set(`msg-${record.id}`, record.timestamp);
    if (record.kind === "execution") tsByKey.set(`exec-${record.id}`, record.timestamp);
    if (record.kind === "refined") tsByKey.set(`refined-${record.id}`, record.timestamp);
    if (record.kind === "clarify") tsByKey.set(`clarify-${record.id}`, record.timestamp);
    if (record.kind === "operator_action") {
      tsByKey.set(`operator-${record.id}`, record.timestamp);
    }
  }
  return injectChatDateSeparators(base, tsByKey);
}

export type ExecutionPin = {
  goalId: string;
  goalTitle: string;
  goalStatus: Goal["status"];
  runId: string;
  run: GoalRunState;
  endedAt: string;
};

export type ChatThreadItem =
  | { kind: "date_separator"; key: string; label: string }
  | { kind: "message"; key: string; message: ChatTextMessage }
  | {
      kind: "crew_exchange";
      key: string;
      recordId: number;
      exchange: CrewExchangeDisplay;
      timestamp: string;
    }
  | { kind: "execution"; key: string; pin: ExecutionPin }
  | {
      kind: "refined";
      key: string;
      recordId: number;
      refined: import("@openx/shared").RefinedGoal;
      linkedGoalId?: string;
      linkedClarifyMessageId?: number;
    }
  | {
      kind: "operator_action";
      key: string;
      recordId: number;
      operatorAction: import("@openx/shared").OperatorActionMeta;
    }
  | {
      kind: "clarify";
      key: string;
      recordId: number;
      clarify: import("@openx/shared").CoachClarifyPayload;
      linkedRefinedMessageId?: number;
    };

export function coachRecordsToThreadItems(
  records: CoachMessageRecord[],
): ChatThreadItem[] {
  const items: ChatThreadItem[] = [];
  for (const record of records) {
    if (record.kind === "tool_result") continue;
    if (record.kind === "text") {
      if (record.role === "coach") {
        const exchange = parseCrewExchangeCoachText(record.text);
        if (exchange) {
          items.push({
            kind: "crew_exchange",
            key: `crew-${record.id}`,
            recordId: record.id,
            exchange,
            timestamp: record.timestamp,
          });
          continue;
        }
      }
      items.push({
        kind: "message",
        key: `msg-${record.id}`,
        message: {
          id: record.id,
          role: record.role,
          text: record.text,
          timestamp: record.timestamp,
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
        linkedClarifyMessageId: record.linkedClarifyMessageId,
      });
      continue;
    }
    if (record.kind === "operator_action") {
      items.push({
        kind: "operator_action",
        key: `operator-${record.id}`,
        recordId: record.id,
        operatorAction: record.operatorAction,
      });
      continue;
    }
    if (record.kind === "clarify") {
      items.push({
        kind: "clarify",
        key: `clarify-${record.id}`,
        recordId: record.id,
        clarify: record.clarify,
        linkedRefinedMessageId: record.linkedRefinedMessageId,
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

/** 最近一条尚未作答的澄清卡 */
export function findLatestPendingClarifyRecord(
  records: CoachMessageRecord[],
  skipRecordIds: ReadonlySet<number> = new Set(),
): Extract<CoachMessageRecord, { kind: "clarify" }> | null {
  const resolved = findResolvedClarifyRecordIds(records);
  const dismissed = findDismissedClarifyRecordIds(records);
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const row = records[i];
    if (row?.kind !== "clarify") continue;
    if (skipRecordIds.has(row.id) || resolved.has(row.id) || dismissed.has(row.id)) {
      continue;
    }
    if (row.clarify.status !== "pending") continue;
    return row;
  }
  return null;
}

export function findRefinedRecordById(
  records: CoachMessageRecord[],
  recordId: number,
): Extract<CoachMessageRecord, { kind: "refined" }> | null {
  const row = records.find((r) => r.kind === "refined" && r.id === recordId);
  return row?.kind === "refined" ? row : null;
}

export function findClarifyRecordById(
  records: CoachMessageRecord[],
  recordId: number,
): Extract<CoachMessageRecord, { kind: "clarify" }> | null {
  const row = records.find((r) => r.kind === "clarify" && r.id === recordId);
  return row?.kind === "clarify" ? row : null;
}
