import {
  buildDeterministicCoachCheckpoint,
  compactCoachThreadTurns,
  type CoachThreadPressure,
} from "@openx/coach";
import {
  coachRecordsToChatTurns,
  DEFAULT_COACH_THREAD_MESSAGE_LIMIT,
  type CoachMessageRecord,
} from "@openx/shared";
import {
  getLatestCoachThreadCheckpoint,
  listCoachMessages,
  saveCoachThreadCheckpoint,
} from "./db.js";

const CHECKPOINT_MIN_OMITTED_TURNS = 8;

export type PreparedCoachThread = {
  records: CoachMessageRecord[];
  turns: ReturnType<typeof coachRecordsToChatTurns>;
  block: string;
  pressure: CoachThreadPressure;
  checkpointWritten: boolean;
};

export function prepareCoachThreadForPrompt(
  conversationId: string,
  opts?: {
    messageLimit?: number;
    beforeMessageId?: number;
    includeExecutionSnapshots?: boolean;
    includeOperatorActions?: boolean;
  },
): PreparedCoachThread {
  const messageLimit = opts?.messageLimit ?? DEFAULT_COACH_THREAD_MESSAGE_LIMIT;
  const allRecords = listCoachMessages(conversationId, Math.max(messageLimit, 80));
  const records = opts?.beforeMessageId
    ? allRecords.filter((row) => row.id <= opts.beforeMessageId!)
    : allRecords;
  const checkpoint = getLatestCoachThreadCheckpoint(conversationId);
  const startId = checkpoint?.upToMessageId ?? 0;
  const recentRecords = records.filter((row) => row.id > startId);

  let turns = coachRecordsToChatTurns(recentRecords, {
    includeExecutionSnapshots: opts?.includeExecutionSnapshots,
    includeOperatorActions: opts?.includeOperatorActions,
  });

  let checkpointPrefix = checkpoint?.summaryText;
  let checkpointWritten = false;

  let compacted = compactCoachThreadTurns(turns, {
    messageLimit,
    checkpointPrefix,
  });

  if (compacted.pressure >= 3) {
    const omitted = records.filter((row) => row.id <= startId);
    const middle = records.filter(
      (row) =>
        row.id > startId &&
        row.id <= (recentRecords[0]?.id ?? startId),
    );
    const checkpointSource =
      middle.length > 0 ? middle : omitted.length > 0 ? omitted : records.slice(0, -messageLimit);
    if (checkpointSource.length >= CHECKPOINT_MIN_OMITTED_TURNS) {
      const summary = buildDeterministicCoachCheckpoint(checkpointSource);
      const upToMessageId = checkpointSource[checkpointSource.length - 1]!.id;
      if (summary.trim()) {
        saveCoachThreadCheckpoint({
          conversationId,
          upToMessageId,
          summaryText: summary,
        });
        checkpointPrefix = summary;
        checkpointWritten = true;
        turns = coachRecordsToChatTurns(
          records.filter((row) => row.id > upToMessageId),
          {
            includeExecutionSnapshots: opts?.includeExecutionSnapshots,
            includeOperatorActions: opts?.includeOperatorActions,
          },
        );
        compacted = compactCoachThreadTurns(turns, {
          messageLimit,
          checkpointPrefix,
        });
      }
    }
  }

  return {
    records,
    turns: compacted.turns,
    block: compacted.block,
    pressure: compacted.pressure,
    checkpointWritten,
  };
}
