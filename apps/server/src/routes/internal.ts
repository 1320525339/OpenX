import { Hono } from "hono";
import { GoalDeliverableSchema, RunDeltaEventSchema } from "@openx/shared";
import { getGoalById } from "../db.js";
import { internalOnly } from "../internal-auth.js";
import {
  appendGoalLog,
  markGoalComplete,
  markGoalFailed,
  updateGoalProgress,
} from "../goal-lifecycle.js";
import { emitGoalRunEvent } from "../run-service.js";
import { maybeAutoReview } from "../auto-review.js";

export const internalRoutes = new Hono();
internalRoutes.use("*", internalOnly);

internalRoutes.post("/goals/:id/progress", async (c) => {
  const goalId = c.req.param("id");
  if (!getGoalById(goalId)) return c.json({ error: "Not found" }, 404);
  const body = (await c.req.json()) as { progress?: unknown; message?: string };
  const progress = Number(body.progress);
  if (!Number.isFinite(progress) || progress < 0 || progress > 100) {
    return c.json({ error: "Invalid progress" }, 400);
  }
  const result = updateGoalProgress(goalId, progress, body.message);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ ok: true });
});

internalRoutes.post("/goals/:id/complete", async (c) => {
  const goalId = c.req.param("id");
  if (!getGoalById(goalId)) return c.json({ error: "Not found" }, 404);
  const body = (await c.req.json()) as {
    resultSummary?: string;
    deliverables?: unknown;
  };
  const deliverables = body.deliverables
    ? GoalDeliverableSchema.array().parse(body.deliverables)
    : undefined;
  const result = markGoalComplete(goalId, body.resultSummary ?? "", deliverables);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  void maybeAutoReview(goalId);
  return c.json({ ok: true });
});

internalRoutes.post("/goals/:id/fail", async (c) => {
  const goalId = c.req.param("id");
  if (!getGoalById(goalId)) return c.json({ error: "Not found" }, 404);
  const body = (await c.req.json()) as { errorMessage?: string };
  const result = markGoalFailed(goalId, body.errorMessage ?? "Unknown error");
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ ok: true });
});

internalRoutes.post("/goals/:id/run-event", async (c) => {
  const goalId = c.req.param("id");
  const goal = getGoalById(goalId);
  if (!goal) return c.json({ error: "Not found" }, 404);
  const event = RunDeltaEventSchema.parse(await c.req.json());
  emitGoalRunEvent(goalId, event);
  return c.json({ ok: true });
});

internalRoutes.post("/goals/:id/log", async (c) => {
  const goalId = c.req.param("id");
  if (!getGoalById(goalId)) return c.json({ error: "Not found" }, 404);
  const body = (await c.req.json()) as { level?: string; message?: string };
  if (!body.message?.trim()) return c.json({ error: "message required" }, 400);
  const level = (["info", "warn", "error", "debug"].includes(body.level ?? "")
    ? body.level
    : "info") as "info" | "warn" | "error" | "debug";
  const result = appendGoalLog(goalId, level, body.message);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ ok: true });
});
