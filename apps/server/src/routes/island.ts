import { Hono } from "hono";
import {
  MarkIslandSeenRequestSchema,
  attentionKeyForPayload,
  isDurableIslandKind,
  type DynamicIslandPayload,
} from "@openx/shared";
import {
  acknowledgeAttention,
  attentionPayloadOrNull,
  getAttentionByKey,
  listOpenAttentions,
  resolveAttentionsForGoal,
} from "../attention-store.js";
import { ensureAttentionsFromGoals } from "../attention-bootstrap.js";
import { bulkMarkIslandSeen, listIslandSeenIds } from "../db.js";

export const islandRoutes = new Hono();

/** 拉取已读灵动岛消息 id（按 scope） */
islandRoutes.get("/seen", (c) => {
  const raw = c.req.query("limit");
  const parsed = raw ? Number.parseInt(raw, 10) : 500;
  const limit = Number.isNaN(parsed) ? 500 : parsed;
  const scopeKey = c.req.query("scopeKey")?.trim() || "global";
  const seenIds = listIslandSeenIds(limit, scopeKey);
  return c.json({ seenIds });
});

/** 批量标记灵动岛消息已读 */
islandRoutes.post("/seen", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const parsed = MarkIslandSeenRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.message }, 400);
  }
  const marked = bulkMarkIslandSeen(parsed.data.ids, parsed.data.scopeKey ?? "global");
  return c.json({ ok: true, marked });
});

/** 开放 attention 列表（Durable 待办事实源） */
islandRoutes.get("/attentions", (c) => {
  const state = c.req.query("state") ?? "open";
  if (state !== "open") {
    return c.json({ error: "仅支持 state=open" }, 400);
  }
  ensureAttentionsFromGoals();
  const raw = c.req.query("limit");
  const parsed = raw ? Number.parseInt(raw, 10) : 200;
  const limit = Number.isNaN(parsed) ? 200 : parsed;
  return c.json({ attentions: listOpenAttentions(limit) });
});

/** 显式确认 attention（知道了） */
islandRoutes.post("/attentions/:key/ack", async (c) => {
  const key = decodeURIComponent(c.req.param("key"));
  const record = acknowledgeAttention(key);
  if (!record) return c.json({ error: "Not found" }, 404);
  return c.json({
    ok: true as const,
    key: record.key,
    state: record.state,
    revision: record.revision,
  });
});

/** dismiss durable 卡时：ack attention（供队列 complete 调用） */
export function ackAttentionForIslandPayload(payload: DynamicIslandPayload): void {
  if (!isDurableIslandKind(payload.kind)) return;
  const key = attentionKeyForPayload(payload);
  if (getAttentionByKey(key)) {
    acknowledgeAttention(key);
  }
}

export function resolveGoalAttentions(goalId: string): void {
  resolveAttentionsForGoal(goalId);
}

export function projectAttentionPayload(key: string): DynamicIslandPayload | null {
  const record = getAttentionByKey(key);
  if (!record || record.state !== "open") return null;
  return attentionPayloadOrNull(record);
}
