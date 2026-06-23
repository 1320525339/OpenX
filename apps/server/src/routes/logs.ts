import { Hono } from "hono";
import { listLogsPage } from "../db.js";

export const logsRoutes = new Hono();

logsRoutes.get("/", (c) => {
  const goalId = c.req.query("goalId");
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 120) || 120, 1), 500);
  const offset = Math.max(Number(c.req.query("offset") ?? 0) || 0, 0);
  const page = listLogsPage({
    goalId: goalId || undefined,
    limit,
    offset,
  });
  return c.json(page);
});
