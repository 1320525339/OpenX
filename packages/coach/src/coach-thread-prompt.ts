import {
  coachRecordsToChatTurns,
  type CoachChatTurn,
  type CoachMessageRecord,
  type CoachRecordsToChatTurnsOptions,
} from "@openx/shared";
import {
  buildCoachThreadBlockFromTurns,
  DEFAULT_COACH_THREAD_CHAR_BUDGET,
} from "./coach-thread-compaction.js";

export {
  buildCoachThreadBlockFromTurns,
  compactCoachThreadTurns,
  detectCoachThreadPressure,
  buildDeterministicCoachCheckpoint,
  COACH_THREAD_CHECKPOINT_HEADING,
  formatCoachThreadTurnLine,
  DEFAULT_COACH_THREAD_CHAR_BUDGET,
  type CoachThreadPressure,
  type CompactCoachThreadOptions,
} from "./coach-thread-compaction.js";

export const COACH_THREAD_HISTORY_HEADING =
  "## 对话历史（同一助手会话，请连贯理解上文）";

/** 与工头 chat 相同标题与行格式的会话前缀块（保留最近轮次） */
export function buildCoachThreadBlock(
  history: CoachChatTurn[] = [],
  maxHistoryChars = DEFAULT_COACH_THREAD_CHAR_BUDGET,
): string {
  return buildCoachThreadBlockFromTurns(history, {
    maxHistoryChars,
    heading: COACH_THREAD_HISTORY_HEADING,
  });
}

export type BuildCoachThreadPrefixOptions = CoachRecordsToChatTurnsOptions & {
  maxHistoryChars?: number;
  checkpointPrefix?: string;
};

/** 持久化 coach 记录 → 与工头 LLM 一致的 thread 前缀（审查复用） */
export function buildCoachThreadPrefixFromRecords(
  records: CoachMessageRecord[],
  options?: BuildCoachThreadPrefixOptions,
): string | undefined {
  const {
    maxHistoryChars,
    checkpointPrefix,
    includeExecutionSnapshots = true,
    includeOperatorActions = true,
  } = options ?? {};
  const turns = coachRecordsToChatTurns(records, {
    includeExecutionSnapshots,
    includeOperatorActions,
  });
  const block = buildCoachThreadBlockFromTurns(turns, {
    maxHistoryChars,
    checkpointPrefix,
    heading: COACH_THREAD_HISTORY_HEADING,
  });
  return block.trim() || undefined;
}
