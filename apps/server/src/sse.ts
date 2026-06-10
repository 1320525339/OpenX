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

/** 持久化并广播；返回单调递增事件 ID */
export function broadcast(event: SseEvent): number {
  const stored = appendSseEvent(event);
  for (const client of clients.values()) {
    try {
      client.send(stored);
    } catch {
      clients.delete(client.id);
    }
  }
  return stored.id;
}
