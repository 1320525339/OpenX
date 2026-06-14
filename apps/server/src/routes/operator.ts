import { Hono } from "hono";
import {
  buildOperatorPlaybook,
  OperatorTierSchema,
  RunWorkflowInputSchema,
} from "@openx/shared";
import { loadSettings } from "../settings-store.js";
import { getServerBaseUrl } from "../server-base-url.js";
import {
  confirmOperatorAction,
  dismissOperatorAction,
  getOperatorAuditLog,
  listPendingOperatorActions,
  operatorCallApi,
} from "../operator-gateway.js";
import { runOperatorSelfTest } from "../operator-self-test.js";
import { operatorToolsEnabled } from "@openx/shared";
import {
  updateCoachOperatorActionStatus,
} from "../coach-operator-messages.js";
import { getBuiltinWorkflow, listBuiltinWorkflows } from "../workflows/builtin.js";
import { runWorkflowDefinition } from "../workflow-runtime.js";

export const operatorRoutes = new Hono();

operatorRoutes.get("/playbook", (c) => {
  const settings = loadSettings();
  if (!operatorToolsEnabled(settings.operatorTier)) {
    return c.json({ error: "operatorTier 为 off，Playbook 不可用" }, 403);
  }
  return c.json({
    ...buildOperatorPlaybook(getServerBaseUrl()),
    workflows: listBuiltinWorkflows(),
  });
});

operatorRoutes.get("/workflows", (c) => {
  const settings = loadSettings();
  if (!operatorToolsEnabled(settings.operatorTier)) {
    return c.json({ error: "operatorTier 为 off" }, 403);
  }
  return c.json({ workflows: listBuiltinWorkflows() });
});

operatorRoutes.post("/workflows/:id/run", async (c) => {
  const settings = loadSettings();
  const tier = OperatorTierSchema.parse(settings.operatorTier);
  if (!operatorToolsEnabled(tier)) {
    return c.json({ error: "operatorTier 为 off" }, 403);
  }
  const workflow = getBuiltinWorkflow(c.req.param("id"));
  if (!workflow) return c.json({ error: "Workflow not found" }, 404);
  const body = RunWorkflowInputSchema.parse(await c.req.json().catch(() => ({})));
  const result = await runWorkflowDefinition(workflow, tier, {
    vars: body.vars,
    stopOnError: body.stopOnError,
  });
  return c.json(result, result.ok ? 200 : 500);
});

operatorRoutes.get("/actions", (c) => {
  const settings = loadSettings();
  if (!operatorToolsEnabled(settings.operatorTier)) {
    return c.json({ error: "operatorTier 为 off" }, 403);
  }
  const conversationId = c.req.query("conversationId");
  return c.json({ actions: listPendingOperatorActions(conversationId) });
});

operatorRoutes.post("/actions/:id/confirm", async (c) => {
  const settings = loadSettings();
  if (settings.operatorTier !== "admin") {
    return c.json({ error: "需要 admin 权限" }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as { messageId?: number };
  const action = await confirmOperatorAction(c.req.param("id"));
  if (!action) return c.json({ error: "Not found or already handled" }, 404);
  if (body.messageId != null) {
    updateCoachOperatorActionStatus(body.messageId, "confirmed");
  }
  return c.json({ ok: true, action });
});

operatorRoutes.post("/actions/:id/dismiss", async (c) => {
  const settings = loadSettings();
  if (settings.operatorTier !== "admin") {
    return c.json({ error: "需要 admin 权限" }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as { messageId?: number };
  const action = dismissOperatorAction(c.req.param("id"));
  if (!action) return c.json({ error: "Not found or already handled" }, 404);
  if (body.messageId != null) {
    updateCoachOperatorActionStatus(body.messageId, "dismissed");
  }
  return c.json({ ok: true, action });
});

operatorRoutes.post("/self-test", async (c) => {
  const settings = loadSettings();
  const tier = settings.operatorTier;
  if (tier !== "operator" && tier !== "admin") {
    return c.json({ error: "需要 operator 或 admin 权限" }, 403);
  }
  const body = (await c.req.json().catch(() => ({}))) as { skipConnect?: boolean };
  const result = await runOperatorSelfTest({
    tier,
    skipConnect: body.skipConnect,
    isolate: false,
  });
  return c.json(result, result.ok ? 200 : 500);
});

operatorRoutes.get("/audit", (c) => {
  const settings = loadSettings();
  if (settings.operatorTier !== "admin") {
    return c.json({ error: "需要 admin 权限" }, 403);
  }
  return c.json({ entries: getOperatorAuditLog() });
});

/** 内部/脚本用：直接 operator call（不走 Coach） */
operatorRoutes.post("/call", async (c) => {
  const settings = loadSettings();
  const tier = OperatorTierSchema.parse(settings.operatorTier);
  if (!operatorToolsEnabled(tier)) {
    return c.json({ error: "operatorTier 为 off" }, 403);
  }
  const body = (await c.req.json()) as {
    method: string;
    path: string;
    pathParams?: Record<string, string>;
    query?: Record<string, string>;
    body?: unknown;
    summary?: string;
    skipConfirm?: boolean;
  };
  const outcome = await operatorCallApi(tier, body, { skipConfirm: body.skipConfirm });
  return c.json(outcome);
});
