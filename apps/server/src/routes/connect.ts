import { Hono } from "hono";
import { ConnectInputSchema, HeartbeatInputSchema } from "@openx/shared";
import { getOpenxSkillsDir } from "@openx/shared/skills-path";
import {
  registerConnection,
  touchConnection,
  removeConnection,
  removeConnectionByExecutorId,
  isGoalCancelledForConnect,
} from "../connect-store.js";
import { getOrCreateInternalToken } from "../internal-auth.js";
import { listGoals } from "../db.js";
import { loadSettings } from "../settings-store.js";
import { enrichGoalWithSkills, resolveExecutorSkills } from "../skills-resolve.js";

export const connectRoutes = new Hono();

connectRoutes.delete("/by-executor/:executorId", (c) => {
  const ok = removeConnectionByExecutorId(c.req.param("executorId"));
  return c.json({ ok });
});

connectRoutes.post("/", async (c) => {
  const input = ConnectInputSchema.parse(await c.req.json());
  const conn = registerConnection(input);
  const base = new URL(c.req.url).origin;
  return c.json({
    connectionId: conn.connectionId,
    agentName: conn.agentName,
    executorId: conn.executorId,
    status: "connected",
    skillsDir: getOpenxSkillsDir(),
    internalToken: getOrCreateInternalToken(),
    sseUrl: `${base}/api/events`,
    heartbeatUrl: `${base}/api/connect/${conn.connectionId}/heartbeat`,
    callbacks: {
      progress: `${base}/internal/goals/{goalId}/progress`,
      complete: `${base}/internal/goals/{goalId}/complete`,
      fail: `${base}/internal/goals/{goalId}/fail`,
      log: `${base}/internal/goals/{goalId}/log`,
      runEvent: `${base}/internal/goals/{goalId}/run-event`,
    },
  });
});

connectRoutes.post("/:connectionId/heartbeat", async (c) => {
  const body = HeartbeatInputSchema.parse(await c.req.json().catch(() => ({})));
  const connectionId = c.req.param("connectionId");
  if (body.connectionId && body.connectionId !== connectionId) {
    return c.json({ error: "connectionId mismatch" }, 400);
  }
  const conn = touchConnection(connectionId);
  if (!conn) return c.json({ error: "Not connected" }, 404);

  const settings = loadSettings();
  const pendingGoals = listGoals("running")
    .filter((g) => g.executorId === conn.executorId)
    .filter((g) => !isGoalCancelledForConnect(g.id))
    .map((g) => enrichGoalWithSkills(g, settings));

  const { hints: enabledSkills } = resolveExecutorSkills(conn.executorId, settings);

  return c.json({
    connectionId: conn.connectionId,
    status: "alive",
    pendingGoals,
    skillsDir: getOpenxSkillsDir(),
    enabledSkills,
    tokenUsage: body.tokenUsage,
  });
});

connectRoutes.delete("/:connectionId", (c) => {
  const ok = removeConnection(c.req.param("connectionId"));
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});
