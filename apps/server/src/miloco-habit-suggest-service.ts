/**
 * Miloco 习惯建议状态机（OpenX 替代 OpenClaw miloco_habit_suggest 工具）
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { getMilocoHabitSuggestPath } from "./paths.js";

const STORE_VERSION = 1;
const MAX_OPEN_QUESTIONS = 1;
const MAX_NEW_ASK_PER_DAY = 1;
const STALE_DAYS = 7;
const STALE_MS = STALE_DAYS * 86_400_000;
const MAX_ASKS = 3;
const TZ = "Asia/Shanghai";

export type SuggestionStatus =
  | "pending"
  | "asked"
  | "accepted"
  | "created"
  | "rejected"
  | "expired";

export type Suggestion = {
  key: string;
  title: string;
  subject: string;
  habit: string;
  suggestion: string;
  evidence?: string;
  status: SuggestionStatus;
  ask_count: number;
  created_at: string;
  updated_at: string;
  asked_at?: string;
  resolved_at?: string;
  task_id?: string;
  item_id?: string;
  reason?: string;
};

export type SuggestionStore = { version: number; entries: Suggestion[] };

export function habitSuggestionsPath(): string {
  const override = process.env.OPENX_MILOCO_HABIT_SUGGEST_PATH?.trim();
  if (override) return override;
  return getMilocoHabitSuggestPath();
}

export function nowLocalIso(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}+08:00`;
}

export function localDateKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}

function elapsedMs(fromIso: string, nowIso: string): number {
  const a = Date.parse(fromIso);
  const b = Date.parse(nowIso);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return b - a;
}

export function applyExpiry(store: SuggestionStore, nowIso: string): boolean {
  let changed = false;
  for (const e of store.entries) {
    const stamp =
      e.status === "asked"
        ? e.asked_at
        : e.status === "accepted"
          ? e.resolved_at
          : undefined;
    if (stamp && elapsedMs(stamp, nowIso) > STALE_MS) {
      e.status = "expired";
      e.resolved_at = nowIso;
      e.reason = `${STALE_DAYS} 天无明确回应自动过期（可重新推荐）`;
      e.updated_at = nowIso;
      changed = true;
    }
  }
  return changed;
}

function askedToday(store: SuggestionStore, nowIso: string): boolean {
  const today = localDateKey(nowIso);
  return store.entries.some(
    (e) => e.asked_at && localDateKey(e.asked_at) === today,
  );
}

function openCount(store: SuggestionStore): number {
  return store.entries.filter((e) => e.status === "asked").length;
}

export function canAskNow(
  store: SuggestionStore,
  nowIso: string,
): { can: boolean; reason?: string } {
  if (openCount(store) >= MAX_OPEN_QUESTIONS) {
    return { can: false, reason: "已有待回应的建议，本次不再打扰" };
  }
  if (MAX_NEW_ASK_PER_DAY > 0 && askedToday(store, nowIso)) {
    return { can: false, reason: "今天已经推荐过一条，明天再说" };
  }
  return { can: true };
}

function loadStore(): SuggestionStore {
  const path = habitSuggestionsPath();
  if (!existsSync(path)) return { version: STORE_VERSION, entries: [] };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as SuggestionStore;
    if (raw && Array.isArray(raw.entries)) {
      return { version: raw.version ?? STORE_VERSION, entries: raw.entries };
    }
  } catch {
    /* ignore */
  }
  return { version: STORE_VERSION, entries: [] };
}

function saveStore(store: SuggestionStore): void {
  const path = habitSuggestionsPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
  renameSync(tmp, path);
}

export function loadOpenQuestions(nowIso = nowLocalIso()): Suggestion[] {
  const store = loadStore();
  return store.entries.filter(
    (e) =>
      e.status === "asked" &&
      e.asked_at &&
      elapsedMs(e.asked_at, nowIso) <= STALE_MS,
  );
}

let writeLock: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => T): Promise<T> {
  const run = writeLock.then(() => fn());
  writeLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function view(e: Suggestion) {
  return {
    key: e.key,
    title: e.title,
    subject: e.subject,
    habit: e.habit,
    suggestion: e.suggestion,
    status: e.status,
    asked_at: e.asked_at,
    task_id: e.task_id,
    item_id: e.item_id,
  };
}

type Dispatch = { res: Record<string, unknown>; dirty: boolean };

function doList(store: SuggestionStore, now: string): Dispatch {
  const gate = canAskNow(store, now);
  const open = store.entries.filter((e) => e.status === "asked");
  const pending = store.entries.filter((e) => e.status === "pending");
  const counts: Record<string, number> = {};
  for (const e of store.entries) counts[e.status] = (counts[e.status] ?? 0) + 1;
  return {
    dirty: false,
    res: {
      ok: true,
      can_ask_now: gate.can,
      blocked_reason: gate.reason,
      open_questions: open.map(view),
      askable_pending: pending.map(view),
      entries: store.entries.map(view),
      counts,
    },
  };
}

function doRecord(
  store: SuggestionStore,
  now: string,
  p: Record<string, unknown>,
): Dispatch {
  const key = str(p.key);
  const subject = str(p.subject) || "shared";
  const habit = str(p.habit);
  const suggestion = str(p.suggestion);
  const title = str(p.title) || habit.slice(0, 24);
  if (!key || !habit || !suggestion) {
    return { dirty: false, res: { ok: false, error: "record 需要 key / habit / suggestion" } };
  }
  const existing = store.entries.find((e) => e.key === key);
  if (existing) {
    if (existing.status === "rejected" || existing.status === "created") {
      return {
        dirty: false,
        res: {
          ok: true,
          key,
          status: existing.status,
          deduped: true,
          note: `已存在且状态为 ${existing.status}，永久不再推荐`,
        },
      };
    }
    if (existing.status === "expired") {
      if (existing.ask_count >= MAX_ASKS) {
        return {
          dirty: false,
          res: {
            ok: true,
            key,
            status: "expired",
            deduped: true,
            note: `已主动询问 ${existing.ask_count} 次仍无果，放弃、不再推荐`,
          },
        };
      }
      existing.status = "pending";
      existing.asked_at = undefined;
      existing.resolved_at = undefined;
      existing.reason = undefined;
      existing.title = title;
      existing.subject = subject;
      existing.habit = habit;
      existing.suggestion = suggestion;
      existing.evidence = str(p.evidence) || existing.evidence;
      existing.item_id = str(p.item_id) || existing.item_id;
      existing.updated_at = now;
      return {
        dirty: true,
        res: { ok: true, key, status: "pending", deduped: true, revived: true },
      };
    }
    let dirty = false;
    if (existing.status === "pending") {
      existing.title = title;
      existing.subject = subject;
      existing.habit = habit;
      existing.suggestion = suggestion;
      existing.evidence = str(p.evidence) || existing.evidence;
      existing.item_id = str(p.item_id) || existing.item_id;
      existing.updated_at = now;
      dirty = true;
    }
    return {
      dirty,
      res: { ok: true, key, status: existing.status, deduped: true },
    };
  }
  store.entries.push({
    key,
    title,
    subject,
    habit,
    suggestion,
    evidence: str(p.evidence) || undefined,
    item_id: str(p.item_id) || undefined,
    status: "pending",
    ask_count: 0,
    created_at: now,
    updated_at: now,
  });
  return { dirty: true, res: { ok: true, key, status: "pending", deduped: false } };
}

function doMarkAsked(
  store: SuggestionStore,
  now: string,
  p: Record<string, unknown>,
): Dispatch {
  const key = str(p.key);
  const e = store.entries.find((x) => x.key === key);
  if (!e) return { dirty: false, res: { ok: false, error: "找不到该建议 key" } };
  if (e.status !== "pending") {
    return { dirty: false, res: { ok: false, status: e.status, error: `状态为 ${e.status}，不能标记为已询问` } };
  }
  const gate = canAskNow(store, now);
  if (!gate.can) {
    return { dirty: false, res: { ok: false, blocked_reason: gate.reason, error: gate.reason } };
  }
  e.status = "asked";
  e.asked_at = now;
  e.updated_at = now;
  e.ask_count += 1;
  return { dirty: true, res: { ok: true, key, status: "asked" } };
}

function doResolve(
  store: SuggestionStore,
  now: string,
  p: Record<string, unknown>,
): Dispatch {
  const key = str(p.key);
  const outcome = str(p.outcome);
  const e = store.entries.find((x) => x.key === key);
  if (!e) return { dirty: false, res: { ok: false, error: "找不到该建议 key" } };
  const from = e.status;

  if (outcome === "rejected") {
    if (from === "created" || from === "expired") {
      return { dirty: false, res: { ok: false, status: from, error: `状态为 ${from}，不能拒绝` } };
    }
    e.status = "rejected";
    e.reason = str(p.reason) || undefined;
    e.resolved_at = now;
    e.updated_at = now;
    return { dirty: true, res: { ok: true, key, status: "rejected" } };
  }

  if (outcome === "accepted") {
    if (from !== "asked") {
      return { dirty: false, res: { ok: false, status: from, error: `状态为 ${from}，不能接受` } };
    }
    e.status = "accepted";
    e.resolved_at = now;
    e.updated_at = now;
    return { dirty: true, res: { ok: true, key, status: "accepted", suggestion: e.suggestion } };
  }

  if (outcome === "created") {
    if (from !== "accepted" && from !== "asked") {
      return { dirty: false, res: { ok: false, status: from, error: `状态为 ${from}，不能标记为已建` } };
    }
    e.status = "created";
    e.task_id = str(p.task_id) || e.task_id;
    e.resolved_at = now;
    e.updated_at = now;
    return { dirty: true, res: { ok: true, key, status: "created", task_id: e.task_id } };
  }

  return { dirty: false, res: { ok: false, error: `未知 outcome：${outcome}` } };
}

export function applyHabitAction(
  input: Record<string, unknown>,
  nowOverride?: string,
): Promise<Record<string, unknown>> {
  return withLock(() => {
    const now = nowOverride ?? nowLocalIso();
    const store = loadStore();
    const expired = applyExpiry(store, now);
    const action = str(input.action);
    let out: Dispatch;
    switch (action) {
      case "list":
        out = doList(store, now);
        break;
      case "record":
        out = doRecord(store, now, input);
        break;
      case "mark_asked":
        out = doMarkAsked(store, now, input);
        break;
      case "resolve":
        out = doResolve(store, now, input);
        break;
      default:
        return { ok: false, error: `未知 action：${action || "(empty)"}` };
    }
    if (out.dirty || expired) saveStore(store);
    return out.res;
  });
}

export function buildPendingSuggestionBlock(): string {
  const open = loadOpenQuestions();
  if (!open.length) return "";
  const lines = open.map(
    (e) =>
      `- key=${e.key} · ${e.title}：${e.suggestion}（habit: ${e.habit}）`,
  );
  return [
    "【待回应的习惯建议】",
    "用户在回应你之前推过的习惯建议，请走 miloco-habit-suggest【路径 B · 回应处理】。",
    ...lines,
  ].join("\n");
}
