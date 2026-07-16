import type { SseEvent } from "@openx/shared";
import { appendSseEvent, type StoredSseEvent } from "./db.js";

type Client = {
  id: string;
  send: (stored: StoredSseEvent) => void;
};

const clients = new Map<string, Client>();

export function addSseClient(send: (stored: StoredSseEvent) => void): string {
  const id = crypto.randomUUID();
  clients.set(id, { id, send });
  return id;
}

export function removeSseClient(id: string): void {
  clients.delete(id);
}

/** 仅内存 fan-out（事务内已 persist 后调用） */
export function fanoutSse(stored: StoredSseEvent): void {
  for (const client of clients.values()) {
    try {
      client.send(stored);
    } catch {
      clients.delete(client.id);
    }
  }
}

/** 持久化并广播；返回单调递增事件 ID */
export function broadcast(event: SseEvent): number {
  const stored = appendSseEvent(event);
  fanoutSse(stored);
  return stored.id;
}

/** 事务内：只写 outbox，事务成功后再 fanoutSse */
export function persistSseEvent(event: SseEvent): StoredSseEvent {
  return appendSseEvent(event);
}
