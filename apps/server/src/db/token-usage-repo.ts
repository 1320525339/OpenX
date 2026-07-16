import { getDb } from "./connection.js";

export type TokenUsageEvent = {
  id: number;
  connectionId?: string;
  goalId?: string;
  runId?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  recordedAt: string;
};

export function insertTokenUsageEvent(input: {
  connectionId?: string;
  goalId?: string;
  runId?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
}): TokenUsageEvent {
  const recordedAt = new Date().toISOString();
  const result = getDb()
    .prepare(
      `INSERT INTO token_usage_events
        (connection_id, goal_id, run_id, model, input_tokens, output_tokens, recorded_at)
       VALUES (@connectionId, @goalId, @runId, @model, @inputTokens, @outputTokens, @recordedAt)`,
    )
    .run({
      connectionId: input.connectionId ?? null,
      goalId: input.goalId ?? null,
      runId: input.runId ?? null,
      model: input.model ?? null,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      recordedAt,
    });
  return {
    id: Number(result.lastInsertRowid),
    connectionId: input.connectionId,
    goalId: input.goalId,
    runId: input.runId,
    model: input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    recordedAt,
  };
}

export function listTokenUsageByGoal(
  goalId: string,
  limit = 50,
): TokenUsageEvent[] {
  const rows = getDb()
    .prepare(
      `SELECT id, connection_id AS connectionId, goal_id AS goalId, run_id AS runId,
              model, input_tokens AS inputTokens, output_tokens AS outputTokens,
              recorded_at AS recordedAt
       FROM token_usage_events WHERE goal_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(goalId, limit) as TokenUsageEvent[];
  return rows;
}

export function sumTokenUsageByGoal(goalId: string): {
  inputTokens: number;
  outputTokens: number;
  events: number;
} {
  const row = getDb()
    .prepare(
      `SELECT
         COALESCE(SUM(input_tokens), 0) AS inputTokens,
         COALESCE(SUM(output_tokens), 0) AS outputTokens,
         COUNT(*) AS events
       FROM token_usage_events WHERE goal_id = ?`,
    )
    .get(goalId) as {
    inputTokens: number;
    outputTokens: number;
    events: number;
  };
  return row;
}
