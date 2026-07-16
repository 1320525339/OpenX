import type { SseEvent } from "@openx/shared";
import { getDb } from "./connection.js";

export const MAX_SSE_CATCHUP = 500;
/** SSE outbox 容量上限（超出按 id 升序删除最旧记录） */
export const MAX_SSE_EVENTS_STORED = 5_000;
/** SSE 保留期限（默认 7 天） */
export const SSE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

let sseAppendCount = 0;

export type StoredSseEvent = {
  id: number;
  eventType: SseEvent["type"];
  payload: SseEvent;
  createdAt: string;
};

export function appendSseEvent(event: SseEvent): StoredSseEvent {
  const createdAt = new Date().toISOString();
  const result = getDb()
    .prepare(
      "INSERT INTO sse_events (event_type, payload_json, created_at) VALUES (?, ?, ?)",
    )
    .run(event.type, JSON.stringify(event), createdAt);
  sseAppendCount += 1;
  if (sseAppendCount % 32 === 0) {
    pruneSseEvents();
  }
  return {
    id: Number(result.lastInsertRowid),
    eventType: event.type,
    payload: event,
    createdAt,
  };
}

/** 按保留期限与容量上限清理 SSE outbox */
export function pruneSseEvents(
  opts: { maxCount?: number; retentionMs?: number } = {},
): void {
  const maxCount = opts.maxCount ?? MAX_SSE_EVENTS_STORED;
  const retentionMs = opts.retentionMs ?? SSE_RETENTION_MS;
  const db = getDb();
  const cutoff = new Date(Date.now() - retentionMs).toISOString();
  db.prepare("DELETE FROM sse_events WHERE created_at < ?").run(cutoff);
  const row = db.prepare("SELECT COUNT(*) as count FROM sse_events").get() as {
    count: number;
  };
  if (row.count <= maxCount) return;
  const excess = row.count - maxCount;
  db.prepare(
    `DELETE FROM sse_events WHERE id IN (
       SELECT id FROM sse_events ORDER BY id ASC LIMIT ?
     )`,
  ).run(excess);
}

export function getSseEventById(id: number): StoredSseEvent | undefined {
  const row = getDb()
    .prepare(
      "SELECT id, event_type as eventType, payload_json as payloadJson, created_at as createdAt FROM sse_events WHERE id = ?",
    )
    .get(id) as
    | { id: number; eventType: string; payloadJson: string; createdAt: string }
    | undefined;
  if (!row) return undefined;
  return {
    id: row.id,
    eventType: row.eventType as SseEvent["type"],
    payload: JSON.parse(row.payloadJson) as SseEvent,
    createdAt: row.createdAt,
  };
}

export function countSseEventsAfter(afterId: number): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) as count FROM sse_events WHERE id > ?")
    .get(afterId) as { count: number };
  return row.count;
}

export function listSseEventsAfter(afterId: number, limit = MAX_SSE_CATCHUP): StoredSseEvent[] {
  return getDb()
    .prepare(
      `SELECT id, event_type as eventType, payload_json as payloadJson, created_at as createdAt
       FROM sse_events WHERE id > ? ORDER BY id ASC LIMIT ?`,
    )
    .all(afterId, limit)
    .map((row) => {
      const r = row as {
        id: number;
        eventType: string;
        payloadJson: string;
        createdAt: string;
      };
      return {
        id: r.id,
        eventType: r.eventType as SseEvent["type"],
        payload: JSON.parse(r.payloadJson) as SseEvent,
        createdAt: r.createdAt,
      };
    });
}

export function listRecentSseEvents(limit = 80): StoredSseEvent[] {
  return getDb()
    .prepare(
      `SELECT id, event_type as eventType, payload_json as payloadJson, created_at as createdAt
       FROM sse_events ORDER BY id DESC LIMIT ?`,
    )
    .all(limit)
    .reverse()
    .map((row) => {
      const r = row as {
        id: number;
        eventType: string;
        payloadJson: string;
        createdAt: string;
      };
      return {
        id: r.id,
        eventType: r.eventType as SseEvent["type"],
        payload: JSON.parse(r.payloadJson) as SseEvent,
        createdAt: r.createdAt,
      };
    });
}
