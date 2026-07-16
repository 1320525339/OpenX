import type {
  AttentionRecord,
  AttentionScope,
  AttentionState,
  DynamicIslandPayload,
  IslandPayloadKind,
  IslandSeverity,
} from "@openx/shared";
import {
  DynamicIslandPayloadSchema,
  attentionKeyForPayload,
  isDurableIslandKind,
} from "@openx/shared";
import { getDb } from "./db/connection.js";
import { broadcast } from "./sse.js";

const ATTENTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type AttentionRow = {
  key: string;
  kind: string;
  goal_id: string | null;
  severity: string;
  state: string;
  revision: number;
  title: string;
  message: string;
  scope_audience: string;
  scope_user_id: string | null;
  scope_device_id: string | null;
  payload_json: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

function rowToRecord(row: AttentionRow): AttentionRecord {
  let payload: unknown;
  if (row.payload_json) {
    try {
      payload = JSON.parse(row.payload_json);
    } catch {
      payload = undefined;
    }
  }
  return {
    key: row.key,
    kind: row.kind as IslandPayloadKind,
    goalId: row.goal_id ?? undefined,
    severity: row.severity as IslandSeverity,
    state: row.state as AttentionState,
    revision: row.revision,
    title: row.title,
    message: row.message,
    scope: {
      audience: (row.scope_audience as AttentionScope["audience"]) || "global",
      userId: row.scope_user_id ?? undefined,
      deviceId: row.scope_device_id ?? undefined,
    },
    expiresAt: row.expires_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    payload,
  };
}

function pruneExpiredAttentions(): void {
  const now = new Date().toISOString();
  getDb().prepare("DELETE FROM attention_records WHERE expires_at IS NOT NULL AND expires_at < ?").run(now);
}

export function listOpenAttentions(limit = 200): AttentionRecord[] {
  pruneExpiredAttentions();
  const capped = Math.max(1, Math.min(limit, 500));
  const rows = getDb()
    .prepare(
      `SELECT * FROM attention_records
       WHERE state = 'open'
       ORDER BY
         CASE severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 WHEN 'info' THEN 2 ELSE 3 END,
         updated_at DESC
       LIMIT ?`,
    )
    .all(capped) as AttentionRow[];
  return rows.map(rowToRecord);
}

export function getAttentionByKey(key: string): AttentionRecord | undefined {
  const row = getDb()
    .prepare("SELECT * FROM attention_records WHERE key = ?")
    .get(key) as AttentionRow | undefined;
  return row ? rowToRecord(row) : undefined;
}

/** 打开或刷新 durable attention，并广播 attention.changed */
export function upsertOpenAttention(
  payload: DynamicIslandPayload,
  scope: AttentionScope = { audience: "global" },
): AttentionRecord | null {
  if (!isDurableIslandKind(payload.kind)) return null;

  const key = attentionKeyForPayload(payload);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ATTENTION_TTL_MS).toISOString();
  const existing = getAttentionByKey(key);
  const revision = (existing?.revision ?? 0) + 1;
  const payloadJson = JSON.stringify(payload);

  getDb()
    .prepare(
      `INSERT INTO attention_records (
        key, kind, goal_id, severity, state, revision, title, message,
        scope_audience, scope_user_id, scope_device_id, payload_json, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        kind = excluded.kind,
        goal_id = excluded.goal_id,
        severity = excluded.severity,
        state = 'open',
        revision = excluded.revision,
        title = excluded.title,
        message = excluded.message,
        scope_audience = excluded.scope_audience,
        scope_user_id = excluded.scope_user_id,
        scope_device_id = excluded.scope_device_id,
        payload_json = excluded.payload_json,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at`,
    )
    .run(
      key,
      payload.kind,
      payload.goalId ?? null,
      payload.severity ?? "info",
      revision,
      payload.title.slice(0, 120),
      payload.message.slice(0, 2000),
      scope.audience,
      scope.userId ?? null,
      scope.deviceId ?? null,
      payloadJson,
      expiresAt,
      existing?.createdAt ?? now,
      now,
    );

  const record = getAttentionByKey(key)!;
  broadcast({
    type: "attention.changed",
    key: record.key,
    revision: record.revision,
    state: record.state,
    goalId: record.goalId,
  });
  return record;
}

export function setAttentionState(
  key: string,
  state: AttentionState,
): AttentionRecord | undefined {
  const existing = getAttentionByKey(key);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const revision = existing.revision + 1;
  getDb()
    .prepare(
      `UPDATE attention_records SET state = ?, revision = ?, updated_at = ? WHERE key = ?`,
    )
    .run(state, revision, now, key);
  const record = getAttentionByKey(key)!;
  broadcast({
    type: "attention.changed",
    key: record.key,
    revision: record.revision,
    state: record.state,
    goalId: record.goalId,
  });
  return record;
}

export function acknowledgeAttention(key: string): AttentionRecord | undefined {
  return setAttentionState(key, "acknowledged");
}

/** 将某 goal 下仍 open 的 attention 全部 resolved（状态离开时） */
export function resolveAttentionsForGoal(
  goalId: string,
  kinds?: IslandPayloadKind[],
): void {
  const rows = getDb()
    .prepare(
      `SELECT key, kind FROM attention_records WHERE goal_id = ? AND state = 'open'`,
    )
    .all(goalId) as Array<{ key: string; kind: string }>;
  for (const row of rows) {
    if (kinds && !kinds.includes(row.kind as IslandPayloadKind)) continue;
    setAttentionState(row.key, "resolved");
  }
}

export function attentionPayloadOrNull(record: AttentionRecord): DynamicIslandPayload | null {
  if (!record.payload) return null;
  const parsed = DynamicIslandPayloadSchema.safeParse(record.payload);
  return parsed.success ? parsed.data : null;
}
