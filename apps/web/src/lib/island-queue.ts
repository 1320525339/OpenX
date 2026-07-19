import type { AttentionRecord, DynamicIslandPayload } from "@openx/shared";
import {
  DynamicIslandPayloadSchema,
  attentionKeyForPayload,
  islandDedupeKey,
  islandSeverityRank,
  isDurableIslandKind,
  withIslandDismissAction,
} from "@openx/shared";

const STORAGE_KEY = "openx.island.queue.v1";
const DEVICE_KEY = "openx.device.id";
const MAX_SEEN = 500;
const MAX_QUEUE = 40;
const SERVER_FLUSH_MS = 300;

type PersistedIslandQueue = {
  seenIds: string[];
  seenDedupeKeys: string[];
  queue: DynamicIslandPayload[];
  /** 溢出的 durable 键（Attention Center） */
  overflowKeys: string[];
};

export type CompleteIslandOptions = {
  payloadId?: string;
  token?: number;
};

let showingId: string | null = null;
let currentPayload: DynamicIslandPayload | null = null;
let currentDisplayToken: number | null = null;
let displayTokenSeq = 0;
let catchupMode = true;

let showHandler: (payload: DynamicIslandPayload, token: number) => void = () => {};
let updateHandler: (payload: DynamicIslandPayload, token: number) => void = () => {};
let dismissHandler: () => void = () => {};
let overflowHandler: (keys: string[]) => void = () => {};

let serverSyncDisabled = false;
let serverFlushTimer: ReturnType<typeof setTimeout> | null = null;
const pendingServerIds = new Set<string>();
let openAttentionCount = 0;

function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = `dev-${crypto.randomUUID()}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "global";
  }
}

export function getIslandScopeKey(): string {
  return `device:${getDeviceId()}`;
}

function loadStore(): PersistedIslandQueue {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { seenIds: [], seenDedupeKeys: [], queue: [], overflowKeys: [] };
    const parsed = JSON.parse(raw) as PersistedIslandQueue;
    return {
      seenIds: Array.isArray(parsed.seenIds) ? parsed.seenIds : [],
      seenDedupeKeys: Array.isArray(parsed.seenDedupeKeys) ? parsed.seenDedupeKeys : [],
      queue: Array.isArray(parsed.queue) ? parsed.queue : [],
      overflowKeys: Array.isArray(parsed.overflowKeys) ? parsed.overflowKeys : [],
    };
  } catch {
    return { seenIds: [], seenDedupeKeys: [], queue: [], overflowKeys: [] };
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
        overflowKeys: data.overflowKeys.slice(-MAX_SEEN),
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
    await api.markIslandSeen(ids, getIslandScopeKey());
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
  show: (payload: DynamicIslandPayload, token: number) => void;
  update?: (payload: DynamicIslandPayload, token: number) => void;
  dismiss: () => void;
  overflow?: (keys: string[]) => void;
}): void {
  showHandler = handlers.show;
  updateHandler = handlers.update ?? handlers.show;
  dismissHandler = handlers.dismiss;
  overflowHandler = handlers.overflow ?? (() => {});
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

export function getIslandDisplayToken(): number | null {
  return currentDisplayToken;
}

export function getIslandShowingId(): string | null {
  return showingId;
}

export function getOpenAttentionCount(): number {
  return openAttentionCount;
}

export function getIslandOverflowKeys(): string[] {
  return loadStore().overflowKeys;
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

function sortQueueBySeverity(queue: DynamicIslandPayload[]): DynamicIslandPayload[] {
  return [...queue].sort((a, b) => {
    const rank = islandSeverityRank(a.severity) - islandSeverityRank(b.severity);
    return rank;
  });
}

function enqueueWithOverflow(data: PersistedIslandQueue, item: DynamicIslandPayload): void {
  if (data.queue.some((q) => q.id === item.id)) return;
  data.queue.push(item);
  data.queue = sortQueueBySeverity(data.queue);

  while (data.queue.length > MAX_QUEUE) {
    // 从队尾找可丢弃的 transient info/success
    let dropIdx = -1;
    for (let i = data.queue.length - 1; i >= 0; i--) {
      const cand = data.queue[i]!;
      if (
        !isDurableIslandKind(cand.kind) &&
        (cand.severity === "info" || cand.severity === "success")
      ) {
        dropIdx = i;
        break;
      }
    }
    if (dropIdx >= 0) {
      data.queue.splice(dropIdx, 1);
      continue;
    }
    // 不能静默丢 error/warning：挪到 overflow
    const overflowed = data.queue.pop()!;
    const key = attentionKeyForPayload(overflowed);
    if (!data.overflowKeys.includes(key)) {
      data.overflowKeys = [...data.overflowKeys, key].slice(-MAX_SEEN);
    }
    overflowHandler(data.overflowKeys);
  }
}

export async function hydrateIslandSeenFromServer(): Promise<void> {
  if (serverSyncDisabled) return;
  try {
    const { api } = await import("../api");
    const { seenIds } = await api.getIslandSeen(MAX_SEEN, getIslandScopeKey());
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

function attentionToPayload(record: AttentionRecord): DynamicIslandPayload | null {
  if (record.payload) {
    const parsed = DynamicIslandPayloadSchema.safeParse(record.payload);
    if (parsed.success) return parsed.data;
  }
  return {
    id: `attention-${record.key}`.slice(0, 128),
    kind: record.kind,
    severity: record.severity,
    title: record.title,
    message: record.message,
    goalId: record.goalId,
    autoDismissMs: isDurableIslandKind(record.kind) ? 0 : 6000,
  };
}

/** 启动 / gap / catchup 结束后从服务端恢复 durable attention */
export async function syncAttentionsFromServer(
  onCount?: (count: number) => void,
): Promise<void> {
  if (serverSyncDisabled) return;
  try {
    const { api } = await import("../api");
    const { attentions } = await api.listAttentions("open");
    openAttentionCount = attentions.length;
    onCount?.(openAttentionCount);
    // 服务端 open 列表已是权威；勿 force，避免覆盖本地「知道了」seen/dedupe
    // （若 ack 失败导致仍 open，未 seen 的仍会正常展示）
    for (const record of attentions) {
      if (record.state !== "open") continue;
      const payload = attentionToPayload(record);
      if (!payload) continue;
      const wasCatchup = catchupMode;
      catchupMode = false;
      requestIsland(payload);
      catchupMode = wasCatchup;
    }
    if (!catchupMode) drainIslandQueue();
  } catch {
    /* 离线或旧版 */
  }
}

export function requestIsland(
  payload: DynamicIslandPayload,
  opts?: { force?: boolean; preempt?: boolean },
): void {
  const normalized = withIslandDismissAction(payload);
  const dedupe = islandDedupeKey(normalized);

  if (!opts?.force && isIslandSeen(normalized.id)) return;
  if (!opts?.force && dedupe && isDedupeSeen(dedupe)) return;
  if (showingId === normalized.id) return;

  if (catchupMode) {
    if (isDurableIslandKind(normalized.kind)) {
      // 不 mark seen；由 syncAttentionsFromServer 恢复
      return;
    }
    // transient：丢弃，且不写服务端 seen
    return;
  }

  if (dedupe && currentPayload && islandDedupeKey(currentPayload) === dedupe) {
    currentPayload = normalized;
    showingId = normalized.id;
    if (currentDisplayToken != null) {
      updateHandler(normalized, currentDisplayToken);
    }
    return;
  }

  // 错误/警告 toast：打断当前展示（不 ack），durable 当前卡重新入队，确保失败反馈立刻可见
  const shouldPreempt =
    opts?.preempt === true ||
    (opts?.preempt !== false &&
      !isDurableIslandKind(normalized.kind) &&
      (normalized.severity === "error" || normalized.severity === "warning") &&
      showingId != null);

  if (shouldPreempt && currentPayload) {
    const paused = currentPayload;
    showingId = null;
    currentPayload = null;
    currentDisplayToken = null;
    dismissHandler();

    const data = loadStore();
    data.queue = data.queue.filter((item) => item.id !== normalized.id);
    if (dedupe) {
      data.queue = data.queue.filter((item) => islandDedupeKey(item) !== dedupe);
    }
    // 抢占卡置顶；被打断的 durable/未读卡紧随其后
    const rest: DynamicIslandPayload[] = [];
    if (
      paused.id !== normalized.id &&
      (isDurableIslandKind(paused.kind) || !isIslandSeen(paused.id))
    ) {
      rest.push(withIslandDismissAction(paused));
    }
    for (const item of data.queue) {
      if (item.id === paused.id) continue;
      rest.push(item);
    }
    data.queue = [normalized, ...rest].slice(0, MAX_QUEUE);
    saveStore(data);
    drainIslandQueue();
    return;
  }

  const data = loadStore();
  if (dedupe) {
    data.queue = data.queue.filter((item) => islandDedupeKey(item) !== dedupe);
  }
  enqueueWithOverflow(data, normalized);
  saveStore(data);

  if (!catchupMode) {
    drainIslandQueue();
  }
}

export function drainIslandQueue(): void {
  if (showingId != null || catchupMode) return;

  const data = loadStore();
  data.queue = sortQueueBySeverity(data.queue);
  while (data.queue.length > 0) {
    const next = data.queue.shift()!;
    if (isIslandSeen(next.id) && !isDurableIslandKind(next.kind)) continue;

    showingId = next.id;
    currentPayload = next;
    currentDisplayToken = ++displayTokenSeq;
    saveStore(data);
    showHandler(next, currentDisplayToken);
    return;
  }
  saveStore(data);
}

export function completeIslandDisplay(opts?: string | CompleteIslandOptions): void {
  const normalized: CompleteIslandOptions =
    typeof opts === "string" || opts === undefined ? { payloadId: opts } : opts;

  if (
    normalized.token != null &&
    currentDisplayToken != null &&
    normalized.token !== currentDisplayToken
  ) {
    return;
  }

  const completedPayload = currentPayload;
  const id =
    normalized.token != null && normalized.token === currentDisplayToken
      ? showingId
      : (normalized.payloadId ?? showingId);
  const dedupe = completedPayload ? islandDedupeKey(completedPayload) : null;

  if (id) markIslandSeen(id, dedupe);

  if (completedPayload && isDurableIslandKind(completedPayload.kind) && !serverSyncDisabled) {
    const key = attentionKeyForPayload(completedPayload);
    void import("../api")
      .then(({ api }) => api.ackAttention(key))
      .catch(() => {});
    openAttentionCount = Math.max(0, openAttentionCount - 1);
  }

  showingId = null;
  currentPayload = null;
  currentDisplayToken = null;

  dismissHandler();
  drainIslandQueue();
}

export function resetIslandQueueForTests(): void {
  showingId = null;
  currentPayload = null;
  currentDisplayToken = null;
  displayTokenSeq = 0;
  catchupMode = true;
  serverSyncDisabled = true;
  openAttentionCount = 0;
  showHandler = () => {};
  updateHandler = () => {};
  dismissHandler = () => {};
  overflowHandler = () => {};
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
