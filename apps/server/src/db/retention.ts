import { getDb } from "./connection.js";

/** 每 goal 最多保留日志条数 */
export const MAX_GOAL_LOGS_PER_GOAL = 2_000;
/** 每 conversation 最多保留 coach 消息 */
export const MAX_COACH_MESSAGES_PER_CONVERSATION = 5_000;
/** 每 goal 最多保留执行摘要 */
export const MAX_EXECUTION_SUMMARIES_PER_GOAL = 50;

let pruneCounter = 0;

function deleteExcessByPartition(
  table: string,
  partitionCol: string,
  maxKeep: number,
): number {
  const db = getDb();
  // 保留每个分区最新 maxKeep 条（按 id DESC）
  return db
    .prepare(
      `DELETE FROM ${table} WHERE id IN (
         SELECT id FROM (
           SELECT id,
                  ROW_NUMBER() OVER (PARTITION BY ${partitionCol} ORDER BY id DESC) AS rn
           FROM ${table}
           WHERE ${partitionCol} IS NOT NULL
         ) WHERE rn > ?
       )`,
    )
    .run(maxKeep).changes;
}

/** 按容量裁剪主业务表（周期触发） */
export function pruneRetentionTables(): {
  goalLogs: number;
  coachMessages: number;
  executionSummaries: number;
} {
  return {
    goalLogs: deleteExcessByPartition("goal_logs", "goal_id", MAX_GOAL_LOGS_PER_GOAL),
    coachMessages: deleteExcessByPartition(
      "coach_messages",
      "conversation_id",
      MAX_COACH_MESSAGES_PER_CONVERSATION,
    ),
    executionSummaries: deleteExcessByPartition(
      "execution_summaries",
      "goal_id",
      MAX_EXECUTION_SUMMARIES_PER_GOAL,
    ),
  };
}

/** 写入后偶发触发保留清理 */
export function maybePruneRetention(): void {
  pruneCounter += 1;
  if (pruneCounter % 64 !== 0) return;
  try {
    pruneRetentionTables();
  } catch (err) {
    console.error("[db] 保留策略清理失败:", err);
  }
}
