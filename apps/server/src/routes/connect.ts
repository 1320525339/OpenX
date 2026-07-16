import { Hono } from "hono";
import {
  ClaimPoolGoalSchema,
  ConnectInputSchema,
  HeartbeatInputSchema,
} from "@openx/shared";
import { getOpenxSkillsDir } from "@openx/shared/skills-path";
import {
  registerConnection,
  touchConnection,
  removeConnection,
  removeConnectionByExecutorId,
  isGoalCancelledForConnect,
} from "../connect-store.js";
import { getOrCreateInternalToken } from "../internal-auth.js";
import {
  getLatestDispatchReceipt,
  insertTokenUsageEvent,
  listGoals,
  getWorkspaceDirForConversation,
} from "../db.js";
import { claimOneConnectPoolGoal } from "../connect-pool.js";
import { loadSettings } from "../settings-store.js";
import { resolveSystemWorkspaceRoot } from "../system-workspace-path.js";
import { enrichGoalWithSkills, resolveExecutorSkills } from "../skills-resolve.js";
import { resolveWorkspaceRoot } from "../workspace-path.js";

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
      ackReceipt: `${base}/internal/dispatch-receipts/ack`,
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

  if (body.tokenUsage) {
    insertTokenUsageEvent({
      connectionId,
      goalId: body.tokenUsage.goalId,
      runId: body.tokenUsage.runId,
      model: body.tokenUsage.model,
      inputTokens: body.tokenUsage.inputTokens,
      outputTokens: body.tokenUsage.outputTokens,
    });
  }

  const settings = loadSettings();

  const autoClaimPool = body.autoClaimPool !== false;
  if (autoClaimPool) {
    claimOneConnectPoolGoal(conn.executorId, conn.agentName);
  }

  const pendingGoals = listGoals("running")
    .filter((g) => g.executorId === conn.executorId)
    .filter((g) => !isGoalCancelledForConnect(g.id))
    .map((g) => {
      const projectDir = getWorkspaceDirForConversation(g.conversationId);
      const workspaceRoot = resolveWorkspaceRoot(
        projectDir ?? resolveSystemWorkspaceRoot(settings),
      );
      const enriched = enrichGoalWithSkills(g, settings, workspaceRoot);
      const receipt = getLatestDispatchReceipt(g.id);
      return {
        goal: enriched,
        receiptId: receipt?.receiptId,
        runId: receipt?.runId,
      };
    });

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

connectRoutes.post("/:connectionId/claim", async (c) => {
  const body = ClaimPoolGoalSchema.parse(await c.req.json().catch(() => ({})));
  const connectionId = c.req.param("connectionId");
  const conn = touchConnection(connectionId);
  if (!conn) return c.json({ error: "Not connected" }, 404);

  const claimed = claimOneConnectPoolGoal(
    conn.executorId,
    conn.agentName,
    body.goalId,
  );
  if (!claimed) {
    return c.json({ error: "No pool goal available to claim" }, 404);
  }
  const receipt = getLatestDispatchReceipt(claimed.id);
  return c.json({
    goal: claimed,
    receiptId: receipt?.receiptId,
    runId: receipt?.runId,
  });
});

connectRoutes.delete("/:connectionId", (c) => {
  const ok = removeConnection(c.req.param("connectionId"));
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});
