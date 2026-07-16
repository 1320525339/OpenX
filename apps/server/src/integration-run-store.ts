import type { IntegrationRun, IntegrationRunStatus } from "@openx/shared";
import { getDb } from "./db.js";

type IntegrationRunRow = {
  id: string;
  integration_id: string;
  lane: string;
  source_key: string | null;
  trace_id: string;
  idempotency_key: string;
  status: string;
  title: string;
  summary: string | null;
  goal_id: string | null;
  payload_json: string | null;
  input_json: string | null;
  result_json: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  updated_at: string;
  finished_at: string | null;
};

function rowToRun(row: IntegrationRunRow): IntegrationRun {
  return {
    id: row.id,
    integrationId: row.integration_id,
    lane: row.lane,
    sourceKey: row.source_key ?? undefined,
    traceId: row.trace_id,
    idempotencyKey: row.idempotency_key,
    status: row.status as IntegrationRunStatus,
    title: row.title,
    summary: row.summary ?? undefined,
    goalId: row.goal_id ?? undefined,
    payloadJson: row.payload_json ?? undefined,
    inputJson: row.input_json ?? undefined,
    resultJson: row.result_json ?? undefined,
    error: row.error ?? undefined,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at ?? undefined,
  };
}

export function insertIntegrationRun(run: IntegrationRun): IntegrationRun {
  getDb()
    .prepare(
      `INSERT INTO integration_runs (
        id, integration_id, lane, source_key, trace_id, idempotency_key, status, title,
        summary, goal_id, payload_json, input_json, result_json, error,
        created_at, started_at, updated_at, finished_at
      ) VALUES (
        @id, @integrationId, @lane, @sourceKey, @traceId, @idempotencyKey, @status, @title,
        @summary, @goalId, @payloadJson, @inputJson, @resultJson, @error,
        @createdAt, @startedAt, @updatedAt, @finishedAt
      )`,
    )
    .run({
      id: run.id,
      integrationId: run.integrationId,
      lane: run.lane,
      sourceKey: run.sourceKey ?? null,
      traceId: run.traceId,
      idempotencyKey: run.idempotencyKey,
      status: run.status,
      title: run.title,
      summary: run.summary ?? null,
      goalId: run.goalId ?? null,
      payloadJson: run.payloadJson ?? null,
      inputJson: run.inputJson ?? null,
      resultJson: run.resultJson ?? null,
      error: run.error ?? null,
      createdAt: run.createdAt,
      startedAt: run.startedAt ?? null,
      updatedAt: run.updatedAt,
      finishedAt: run.finishedAt ?? null,
    });
  return run;
}

export function updateIntegrationRun(run: IntegrationRun): void {
  getDb()
    .prepare(
      `UPDATE integration_runs SET
        status = @status,
        title = @title,
        summary = @summary,
        goal_id = @goalId,
        payload_json = @payloadJson,
        input_json = @inputJson,
        result_json = @resultJson,
        error = @error,
        source_key = @sourceKey,
        started_at = @startedAt,
        updated_at = @updatedAt,
        finished_at = @finishedAt
      WHERE id = @id`,
    )
    .run({
      id: run.id,
      status: run.status,
      title: run.title,
      summary: run.summary ?? null,
      goalId: run.goalId ?? null,
      payloadJson: run.payloadJson ?? null,
      inputJson: run.inputJson ?? null,
      resultJson: run.resultJson ?? null,
      error: run.error ?? null,
      sourceKey: run.sourceKey ?? null,
      startedAt: run.startedAt ?? null,
      updatedAt: run.updatedAt,
      finishedAt: run.finishedAt ?? null,
    });
}

export function getIntegrationRunById(id: string): IntegrationRun | null {
  const row = getDb()
    .prepare(`SELECT * FROM integration_runs WHERE id = ?`)
    .get(id) as IntegrationRunRow | undefined;
  return row ? rowToRun(row) : null;
}

export function getIntegrationRunByIdempotency(
  integrationId: string,
  idempotencyKey: string,
): IntegrationRun | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM integration_runs WHERE integration_id = ? AND idempotency_key = ?`,
    )
    .get(integrationId, idempotencyKey) as IntegrationRunRow | undefined;
  return row ? rowToRun(row) : null;
}

export function listIntegrationRuns(opts: {
  integrationId: string;
  lane?: string;
  limit?: number;
}): IntegrationRun[] {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  if (opts.lane) {
    return (
      getDb()
        .prepare(
          `SELECT * FROM integration_runs
           WHERE integration_id = ? AND lane = ?
           ORDER BY created_at DESC LIMIT ?`,
        )
        .all(opts.integrationId, opts.lane, limit) as IntegrationRunRow[]
    ).map(rowToRun);
  }
  return (
    getDb()
      .prepare(
        `SELECT * FROM integration_runs
         WHERE integration_id = ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(opts.integrationId, limit) as IntegrationRunRow[]
  ).map(rowToRun);
}

export function countActiveIntegrationRuns(
  integrationId: string,
  lane?: string,
): number {
  if (lane) {
    const row = getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM integration_runs
         WHERE integration_id = ? AND lane = ?
           AND status IN ('queued', 'running', 'accepted')`,
      )
      .get(integrationId, lane) as { n: number };
    return row.n;
  }
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM integration_runs
       WHERE integration_id = ?
         AND status IN ('queued', 'running', 'accepted')`,
    )
    .get(integrationId) as { n: number };
  return row.n;
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 30;
const RETENTION_MAX = 10_000;

export function upsertIntegrationIdempotency(input: {
  integrationId: string;
  idempotencyKey: string;
  runId: string;
  status: string;
}): void {
  const now = new Date();
  const expires = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString();
  getDb()
    .prepare(
      `INSERT INTO integration_idempotency (
        idempotency_key, integration_id, run_id, status, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(integration_id, idempotency_key) DO UPDATE SET
        run_id = excluded.run_id,
        status = excluded.status,
        expires_at = excluded.expires_at`,
    )
    .run(
      input.idempotencyKey,
      input.integrationId,
      input.runId,
      input.status,
      now.toISOString(),
      expires,
    );
}

export function getIntegrationIdempotency(
  integrationId: string,
  idempotencyKey: string,
): { runId: string; status: string; expiresAt: string } | null {
  const row = getDb()
    .prepare(
      `SELECT run_id, status, expires_at FROM integration_idempotency
       WHERE integration_id = ? AND idempotency_key = ?`,
    )
    .get(integrationId, idempotencyKey) as
    | { run_id: string; status: string; expires_at: string }
    | undefined;
  if (!row) return null;
  if (Date.parse(row.expires_at) < Date.now()) return null;
  return { runId: row.run_id, status: row.status, expiresAt: row.expires_at };
}

/** 清理过期运行记录（30 天或超过 1 万条） */
export function pruneIntegrationRuns(integrationId = "miloco"): number {
  const db = getDb();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  const byAge = db
    .prepare(
      `DELETE FROM integration_runs WHERE integration_id = ? AND created_at < ?`,
    )
    .run(integrationId, cutoff);
  const countRow = db
    .prepare(`SELECT COUNT(*) AS n FROM integration_runs WHERE integration_id = ?`)
    .get(integrationId) as { n: number };
  let byCap = 0;
  if (countRow.n > RETENTION_MAX) {
    const overflow = countRow.n - RETENTION_MAX;
    const ids = db
      .prepare(
        `SELECT id FROM integration_runs WHERE integration_id = ?
         ORDER BY created_at ASC LIMIT ?`,
      )
      .all(integrationId, overflow) as Array<{ id: string }>;
    const del = db.prepare(`DELETE FROM integration_runs WHERE id = ?`);
    for (const row of ids) {
      del.run(row.id);
      byCap += 1;
    }
  }
  return Number(byAge.changes ?? 0) + byCap;
}
