import { Hono } from "hono";
import { MarkIslandSeenRequestSchema } from "@openx/shared";
import { bulkMarkIslandSeen, listIslandSeenIds } from "../db.js";

export const islandRoutes = new Hono();

/** 拉取已读灵动岛消息 id（跨浏览器/设备同步） */
islandRoutes.get("/seen", (c) => {
  const raw = c.req.query("limit");
  const parsed = raw ? Number.parseInt(raw, 10) : 500;
  const limit = Number.isNaN(parsed) ? 500 : parsed;
  const seenIds = listIslandSeenIds(limit);
  return c.json({ seenIds });
});

/** 批量标记灵动岛消息已读 */
islandRoutes.post("/seen", async (c) => {
  const body = MarkIslandSeenRequestSchema.parse(await c.req.json());
  const marked = bulkMarkIslandSeen(body.ids);
  return c.json({ ok: true, marked });
});
