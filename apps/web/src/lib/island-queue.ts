import type { DynamicIslandPayload } from "@openx/shared";
import { islandDedupeKey, withIslandDismissAction } from "@openx/shared";

const STORAGE_KEY = "openx.island.queue.v1";

const MAX_SEEN = 500;

const MAX_QUEUE = 40;

const SERVER_FLUSH_MS = 300;



type PersistedIslandQueue = {
  seenIds: string[];
  /** 已关闭的 goal+kind 去重键，避免同状态补丁重复弹窗 */
  seenDedupeKeys: string[];
  queue: DynamicIslandPayload[];
};



let showingId: string | null = null;

let currentPayload: DynamicIslandPayload | null = null;

let catchupMode = true;

let showHandler: (payload: DynamicIslandPayload) => void = () => {};

let updateHandler: (payload: DynamicIslandPayload) => void = () => {};

let dismissHandler: () => void = () => {};

let serverSyncDisabled = false;

let serverFlushTimer: ReturnType<typeof setTimeout> | null = null;

const pendingServerIds = new Set<string>();



function loadStore(): PersistedIslandQueue {

  try {

    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) return { seenIds: [], seenDedupeKeys: [], queue: [] };

    const parsed = JSON.parse(raw) as PersistedIslandQueue;

    return {
      seenIds: Array.isArray(parsed.seenIds) ? parsed.seenIds : [],
      seenDedupeKeys: Array.isArray(parsed.seenDedupeKeys) ? parsed.seenDedupeKeys : [],
      queue: Array.isArray(parsed.queue) ? parsed.queue : [],
    };
  } catch {
    return { seenIds: [], seenDedupeKeys: [], queue: [] };

  }

}



function saveStore(data: PersistedIslandQueue): void {

  try {

    localStorage.setItem(

      STORAGE_KEY,

      JSON.stringify({
        seenIds: data.seenIds.slice(-MAX_SEEN),
        seenDedupeKeys: data.seenDedupeKeys.slice(-MAX_SEEN),
        queue: data.queue.slice(-MAX_QUEUE),
      }),

    );

  } catch {

    /* quota */

  }

}



function mergeSeenIds(local: string[], remote: string[]): string[] {

  return [...new Set([...local, ...remote])].slice(-MAX_SEEN);

}



function scheduleServerMark(id: string): void {

  if (serverSyncDisabled) return;

  pendingServerIds.add(id);

  if (serverFlushTimer != null) return;

  serverFlushTimer = setTimeout(() => void flushServerMarks(), SERVER_FLUSH_MS);

}



async function flushServerMarks(): Promise<void> {

  serverFlushTimer = null;

  const ids = [...pendingServerIds];

  pendingServerIds.clear();

  if (ids.length === 0) return;

  try {

    const { api } = await import("../api");

    await api.markIslandSeen(ids);

  } catch {

    for (const id of ids) pendingServerIds.add(id);

    if (serverFlushTimer == null) {

      serverFlushTimer = setTimeout(() => void flushServerMarks(), 2000);

    }

  }

}



function isDedupeSeen(key: string): boolean {
  return loadStore().seenDedupeKeys.includes(key);
}

export function clearIslandSeenDedupe(key: string): void {
  const data = loadStore();
  data.seenDedupeKeys = data.seenDedupeKeys.filter((k) => k !== key);
  saveStore(data);
}

export function bindIslandQueueHandlers(handlers: {
  show: (payload: DynamicIslandPayload) => void;
  update?: (payload: DynamicIslandPayload) => void;
  dismiss: () => void;
}): void {
  showHandler = handlers.show;
  updateHandler = handlers.update ?? handlers.show;
  dismissHandler = handlers.dismiss;
}



export function setIslandCatchupMode(enabled: boolean): void {

  catchupMode = enabled;

  if (!enabled) drainIslandQueue();

}



export function isIslandCatchupMode(): boolean {

  return catchupMode;

}



export function isIslandSeen(id: string): boolean {

  return loadStore().seenIds.includes(id);

}



export function markIslandSeen(id: string, dedupeKey?: string | null): void {
  const data = loadStore();

  if (!data.seenIds.includes(id)) {
    data.seenIds = [...data.seenIds, id].slice(-MAX_SEEN);
  }
  if (dedupeKey && !data.seenDedupeKeys.includes(dedupeKey)) {
    data.seenDedupeKeys = [...data.seenDedupeKeys, dedupeKey].slice(-MAX_SEEN);
  }

  data.queue = data.queue.filter((item) => item.id !== id);
  if (dedupeKey) {
    data.queue = data.queue.filter((item) => islandDedupeKey(item) !== dedupeKey);
  }

  saveStore(data);

  scheduleServerMark(id);
}



/** 启动时从服务端拉取已读列表，与本地合并 */

export async function hydrateIslandSeenFromServer(): Promise<void> {

  if (serverSyncDisabled) return;

  try {

    const { api } = await import("../api");

    const { seenIds } = await api.getIslandSeen(MAX_SEEN);

    if (seenIds.length === 0) return;

    const data = loadStore();

    const merged = mergeSeenIds(data.seenIds, seenIds);

    data.seenIds = merged;

    data.queue = data.queue.filter((item) => !merged.includes(item.id));

    saveStore(data);

  } catch {

    /* 离线或旧版 server */

  }

}



/** 入队；未读且未展示过的才会加入。catchup 结束后自动按序弹出。 */

export function requestIsland(payload: DynamicIslandPayload): void {
  const normalized = withIslandDismissAction(payload);
  const dedupe = islandDedupeKey(normalized);

  if (isIslandSeen(normalized.id)) return;
  if (dedupe && isDedupeSeen(dedupe)) return;
  if (showingId === normalized.id) return;

  // SSE 历史重放期间静默标记已读，避免一进页面弹出旧通知
  if (catchupMode) {
    markIslandSeen(normalized.id, dedupe);
    return;
  }

  if (dedupe && currentPayload && islandDedupeKey(currentPayload) === dedupe) {
    currentPayload = normalized;
    showingId = normalized.id;
    updateHandler(normalized);
    return;
  }

  const data = loadStore();
  if (dedupe) {
    data.queue = data.queue.filter((item) => islandDedupeKey(item) !== dedupe);
  }
  if (data.queue.some((item) => item.id === normalized.id)) return;

  data.queue.push(normalized);
  saveStore(data);

  if (!catchupMode) {
    drainIslandQueue();
  }
}



export function drainIslandQueue(): void {

  if (showingId != null || catchupMode) return;



  const data = loadStore();

  while (data.queue.length > 0) {

    const next = data.queue.shift()!;

    if (isIslandSeen(next.id)) continue;

    showingId = next.id;
    currentPayload = next;
    saveStore(data);

    showHandler(next);

    return;

  }

  saveStore(data);

}



/** 用户关闭 / 自动消失 / 操作完成后调用 */

export function completeIslandDisplay(payloadId?: string): void {
  const id = payloadId ?? showingId;
  const dedupe = currentPayload ? islandDedupeKey(currentPayload) : null;

  if (id) markIslandSeen(id, dedupe);

  showingId = null;
  currentPayload = null;

  dismissHandler();

  drainIslandQueue();
}



export function resetIslandQueueForTests(): void {
  showingId = null;
  currentPayload = null;
  catchupMode = true;

  serverSyncDisabled = true;

  showHandler = () => {};
  updateHandler = () => {};

  dismissHandler = () => {};

  pendingServerIds.clear();

  if (serverFlushTimer != null) {

    clearTimeout(serverFlushTimer);

    serverFlushTimer = null;

  }

  try {

    localStorage.removeItem(STORAGE_KEY);

  } catch {

    /* ignore */

  }

}


