import { Hono } from "hono";
import {
  MILOCO_BATCH2_ONLY_SKILL_IDS,
  MILOCO_BATCH3_ONLY_SKILL_IDS,
  MILOCO_DEFAULT_PORT,
  MILOCO_DASHBOARD_URL,
  MILOCO_EVENTS_CONVERSATION_ID,
  MILOCO_PROACTIVE_SKILL_IDS,
  MILOCO_SYNC_SKILL_IDS,
  MILOCO_WEBHOOK_PATH,
  milocoOpenxExecutionPreamble,
  milocoWebhookUrl,
} from "@openx/shared";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyMilocoSkillBindings,
  syncMilocoSkills,
} from "../miloco-skills-service.js";
import {
  getOrCreateMilocoWebhookToken,
  isMilocoWebhookTokenConfigured,
  verifyMilocoWebhookBearer,
} from "../miloco-webhook-auth.js";
import {
  handleMilocoAgentTurn,
  handleMilocoGetTrace,
  enqueueMilocoAgentTurn,
  listMilocoEventRuns,
  resolveMilocoIdempotencyKey,
  type MilocoAgentTurnPayload,
} from "../miloco-webhook-service.js";
import { runMilocoWslCli } from "../miloco-cli-runner.js";
import {
  addMilocoDashboardCard,
  connectMilocoWebhookWsl,
  disableMilocoScopeCameras,
  enableMilocoScopeCameras,
} from "../miloco-layer-b-service.js";
import {
  getCachedMilocoLayerBStatus,
  refreshMilocoLayerBStatus,
} from "../miloco-layer-b-cache.js";
import {
  getMilocoHomeCronStatus,
  triggerMilocoCronTask,
  type MilocoCronTaskName,
} from "../miloco-home-cron-watchdog.js";
import { applyHabitAction } from "../miloco-habit-suggest-service.js";
import {
  getMilocoPresenceStatus,
  isMilocoPresenceWatchEnabled,
  resolveMilocoPresenceIntervalMs,
  runMilocoPresenceOnce,
} from "../miloco-presence-watchdog.js";
import {
  loadMilocoUserConfig,
  saveMilocoUserConfig,
} from "../miloco-config.js";
import { loadSettings } from "../settings-store.js";
import { mergedSkillBindings } from "../skills-resolve.js";
import { listSkillCatalog, loadSkillManifest } from "../skills-service.js";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const OPENX_ROOT = process.env.OPENX_ROOT ?? resolve(SERVER_DIR, "../../../..");
const WEBHOOK_PORT = Number(process.env.PORT ?? MILOCO_DEFAULT_PORT);

export const milocoRoutes = new Hono();

/** 禁用时拒绝业务请求（路由仍挂载） */
milocoRoutes.use("*", async (c, next) => {
  const { resolveMilocoEnabled } = await import("../miloco-integration-settings.js");
  const gate = resolveMilocoEnabled();
  if (!gate.enabled) {
    return c.json(
      {
        ok: false,
        code: "integration_disabled",
        error: "integration_disabled",
        message: gate.reason ?? "integration_disabled",
      },
      409,
    );
  }
  await next();
});

milocoRoutes.get("/status", (c) => {
  const settings = loadSettings();
  const manifest = loadSkillManifest();
  const catalog = listSkillCatalog(manifest);
  const bindings = mergedSkillBindings(settings);
  const installed = MILOCO_PROACTIVE_SKILL_IDS.filter((id) =>
    catalog.some((s) => s.id === id && s.installed),
  );
  const boundToPi = MILOCO_PROACTIVE_SKILL_IDS.filter((id) => {
    const b = bindings[id];
    return b?.enabled && b.cliIds.includes("pi");
  });
  const batch2Installed = MILOCO_BATCH2_ONLY_SKILL_IDS.filter((id) =>
    catalog.some((s) => s.id === id && s.installed),
  );
  const batch2BoundToPi = MILOCO_BATCH2_ONLY_SKILL_IDS.filter((id) => {
    const b = bindings[id];
    return b?.enabled && b.cliIds.includes("pi");
  });
  const batch3Installed = MILOCO_BATCH3_ONLY_SKILL_IDS.filter((id) =>
    catalog.some((s) => s.id === id && s.installed),
  );
  const batch3BoundToPi = MILOCO_BATCH3_ONLY_SKILL_IDS.filter((id) => {
    const b = bindings[id];
    return b?.enabled && b.cliIds.includes("pi");
  });

  return c.json({
    dashboardUrl: MILOCO_DASHBOARD_URL,
    oxspTemplateId: "miloco-dashboard",
    skillsInstalled: installed,
    skillsBoundToPi: boundToPi,
    syncSkillsInstalled: MILOCO_SYNC_SKILL_IDS.filter((id) =>
      catalog.some((s) => s.id === id && s.installed),
    ),
    batch2SkillsInstalled: batch2Installed,
    batch2SkillsBoundToPi: batch2BoundToPi,
    batch3SkillsInstalled: batch3Installed,
    batch3SkillsBoundToPi: batch3BoundToPi,
    executionPreamble: milocoOpenxExecutionPreamble(OPENX_ROOT),
    wrapperScript: resolve(OPENX_ROOT, "scripts/miloco-wsl.ps1"),
    webhook: {
      path: MILOCO_WEBHOOK_PATH,
      port: WEBHOOK_PORT,
      url: milocoWebhookUrl("127.0.0.1", WEBHOOK_PORT),
      tokenConfigured: isMilocoWebhookTokenConfigured(),
      proactiveSkillsBoundToPi: boundToPi,
    },
    presenceWatch: {
      enabled: isMilocoPresenceWatchEnabled(),
      intervalMs: resolveMilocoPresenceIntervalMs(),
    },
    homeCronWatch: {
      enabled: process.env.OPENX_MILOCO_HOME_CRON_WATCH === "1",
    },
  });
});

milocoRoutes.get("/home-cron", (c) => {
  return c.json(getMilocoHomeCronStatus());
});

milocoRoutes.post("/home-cron/trigger", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { name?: string };
  const name = body.name?.trim() as MilocoCronTaskName | undefined;
  if (!name) return c.json({ ok: false, error: "missing name" }, 400);
  const result = triggerMilocoCronTask(name);
  if (!result.ok) return c.json(result, 400);
  return c.json(result);
});

milocoRoutes.post("/habit-suggest", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const result = await applyHabitAction(body);
  return c.json(result);
});

milocoRoutes.post("/im-push", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { text?: string };
  const text = body.text?.trim();
  if (!text) return c.json({ ok: false, error: "missing text" }, 400);
  const cli = await runMilocoWslCli(["notify", "push", "--text", text]);
  if (!cli.ok) {
    const needsBind = /bind|绑定|未配置/i.test(cli.stderr + cli.stdout);
    return c.json({
      ok: false,
      needsBind,
      error: cli.stderr || cli.stdout || "notify push failed",
    });
  }
  return c.json({ ok: true });
});

milocoRoutes.get("/config", (c) => {
  return c.json(loadMilocoUserConfig());
});

milocoRoutes.put("/config", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Partial<
    import("../miloco-config.js").MilocoUserConfig
  >;
  const saved = saveMilocoUserConfig(body);
  return c.json(saved);
});

milocoRoutes.get("/homes", async (c) => {
  const cli = await runMilocoWslCli(["admin", "status"], { timeoutMs: 30_000 });
  if (!cli.ok) {
    return c.json({ ok: false, error: cli.stderr || cli.stdout || "admin status failed", homes: [] });
  }
  // 设备列表用于向导选监测 DID
  const devices = await runMilocoWslCli(["device", "list"], { timeoutMs: 45_000 });
  const lines = (devices.stdout ?? "").split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
  const deviceRows = lines.map((line) => {
    const parts = line.split("|");
    return {
      did: parts[0]?.trim() ?? "",
      name: parts[1]?.trim() ?? "",
      room: parts[2]?.trim() ?? "",
      category: parts[3]?.trim() ?? "",
      online: parts[4]?.trim() === "online",
    };
  }).filter((d) => d.did);
  return c.json({
    ok: true,
    homes: loadMilocoUserConfig().homeId
      ? [{ id: loadMilocoUserConfig().homeId, name: loadMilocoUserConfig().homeName }]
      : [],
    devices: deviceRows,
    config: loadMilocoUserConfig(),
  });
});

milocoRoutes.post("/setup-wizard/complete", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    homeId?: string;
    homeName?: string;
    watchDids?: string[];
    enabledCameraDids?: string[];
    webhookHost?: string;
  };
  const saved = saveMilocoUserConfig({
    homeId: body.homeId?.trim(),
    homeName: body.homeName?.trim(),
    watchDids: body.watchDids ?? [],
    enabledCameraDids: body.enabledCameraDids ?? [],
    webhookHost: body.webhookHost?.trim(),
    setupCompletedAt: new Date().toISOString(),
  });
  if (body.enabledCameraDids?.length) {
    void enableMilocoScopeCameras(body.enabledCameraDids);
  }
  if (body.webhookHost) {
    await connectMilocoWebhookWsl(body.webhookHost, WEBHOOK_PORT);
  }
  void refreshMilocoLayerBStatus(true);
  return c.json({ ok: true, config: saved });
});

milocoRoutes.get("/events", (c) => {
  const limit = Math.min(
    100,
    Math.max(1, Number.parseInt(c.req.query("limit") ?? "50", 10) || 50),
  );
  const laneFilter = c.req.query("lane")?.trim();
  const runs = listMilocoEventRuns(limit, laneFilter || undefined);
  return c.json({
    conversationId: MILOCO_EVENTS_CONVERSATION_ID,
    goals: runs,
    runs,
  });
});

milocoRoutes.get("/presence", (c) => {
  const status = getMilocoPresenceStatus();
  return c.json(status);
});

milocoRoutes.post("/presence/poll", async (c) => {
  const summary = await runMilocoPresenceOnce();
  return c.json(summary);
});

milocoRoutes.get("/layer-b", (c) => {
  const cached = getCachedMilocoLayerBStatus();
  // 无缓存时异步预热，接口仍立即返回
  if (!cached.checkedAt) void refreshMilocoLayerBStatus();
  return c.json(cached);
});

milocoRoutes.post("/layer-b/refresh", async (c) => {
  void refreshMilocoLayerBStatus(true);
  return c.json(getCachedMilocoLayerBStatus());
});

milocoRoutes.post("/connect-wsl", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { webhookHost?: string };
  const host = body.webhookHost?.trim() || "127.0.0.1";
  const result = await connectMilocoWebhookWsl(host, WEBHOOK_PORT);
  if (!result.ok) {
    return c.json(result, 500);
  }
  void refreshMilocoLayerBStatus(true);
  return c.json(result);
});

milocoRoutes.post("/add-card", (c) => {
  const result = addMilocoDashboardCard();
  if (!result.ok) {
    return c.json(result, 500);
  }
  return c.json(result);
});

milocoRoutes.post("/layer-b/cameras/enable", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { dids?: string[] };
  const dids = (body.dids ?? []).map((d) => String(d).trim()).filter(Boolean);
  if (!dids.length) {
    return c.json({ ok: false, error: "missing dids" }, 400);
  }
  const cli = await enableMilocoScopeCameras(dids);
  void refreshMilocoLayerBStatus(true);
  return c.json({
    ok: cli.ok,
    stdout: cli.stdout,
    error: cli.ok ? undefined : cli.stderr || cli.stdout,
    status: getCachedMilocoLayerBStatus(),
  });
});

milocoRoutes.post("/layer-b/cameras/disable", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { dids?: string[] };
  const dids = (body.dids ?? []).map((d) => String(d).trim()).filter(Boolean);
  if (!dids.length) {
    return c.json({ ok: false, error: "missing dids" }, 400);
  }
  const cli = await disableMilocoScopeCameras(dids);
  void refreshMilocoLayerBStatus(true);
  return c.json({
    ok: cli.ok,
    stdout: cli.stdout,
    error: cli.ok ? undefined : cli.stderr || cli.stdout,
    status: getCachedMilocoLayerBStatus(),
  });
});

milocoRoutes.post("/setup", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { force?: boolean };
  const sync = syncMilocoSkills(body.force === true);
  if (sync.ok) {
    applyMilocoSkillBindings();
    getOrCreateMilocoWebhookToken();
  }
  return c.json({
    ok: sync.ok,
    installed: sync.installed,
    source: sync.source,
    error: sync.error,
    dashboardUrl: MILOCO_DASHBOARD_URL,
    webhookUrl: milocoWebhookUrl("127.0.0.1", WEBHOOK_PORT),
    tokenConfigured: isMilocoWebhookTokenConfigured(),
  });
});

milocoRoutes.get("/webhook", (c) => {
  return c.json({
    ok: true,
    service: "miloco-webhook",
    path: MILOCO_WEBHOOK_PATH,
    tokenConfigured: isMilocoWebhookTokenConfigured(),
  });
});

milocoRoutes.post("/webhook", async (c) => {
  const authHeader = c.req.header("authorization");
  if (!verifyMilocoWebhookBearer(authHeader)) {
    return c.json({ code: 401, message: "unauthorized", data: null }, 401);
  }

  let body: { action?: string; payload?: Record<string, unknown> };
  try {
    body = (await c.req.json()) as { action?: string; payload?: Record<string, unknown> };
  } catch {
    return c.json({ code: 400, message: "invalid json", data: null }, 400);
  }

  const action = body.action?.trim();
  if (!action) {
    return c.json({ code: 400, message: "missing action", data: null }, 400);
  }

  try {
    if (action === "agent") {
      const payload = body.payload ?? {};
      const message = String(payload.message ?? "");
      if (!message.trim()) {
        return c.json({ code: 400, message: "missing message", data: null }, 400);
      }

      const waitFlag =
        payload.wait === true ||
        payload.wait === "true" ||
        c.req.query("sync") === "1";

      const resolvedKey = resolveMilocoIdempotencyKey({
        idempotencyKey:
          payload.idempotencyKey != null ? String(payload.idempotencyKey) : undefined,
        traceId: payload.traceId != null ? String(payload.traceId) : undefined,
      });
      if (!resolvedKey) {
        return c.json(
          {
            code: 400,
            message: "missing idempotencyKey or traceId",
            data: null,
          },
          400,
        );
      }

      const turnPayload: MilocoAgentTurnPayload = {
        message,
        sessionKey: String(payload.sessionKey ?? ""),
        lane: String(payload.lane ?? ""),
        traceId: String(payload.traceId ?? "").trim() || resolvedKey,
        idempotencyKey: resolvedKey,
        timeoutMs: Number(payload.timeoutMs ?? 180_000),
        wait: waitFlag,
      };

      if (waitFlag) {
        const result = await handleMilocoAgentTurn(turnPayload);
        return c.json({
          code: 0,
          message: "ok",
          data: {
            runId: result.runId,
            status: result.status,
            ...(result.error ? { error: result.error } : {}),
          },
        });
      }

      const enqueued = enqueueMilocoAgentTurn({ ...turnPayload, wait: false });
      // 后台执行，不阻塞 HTTP
      void enqueued.promise;
      return c.json(
        {
          code: 0,
          message: "accepted",
          data: {
            runId: enqueued.runId,
            status: "accepted",
            ...(enqueued.error ? { error: enqueued.error } : {}),
          },
        },
        202,
      );
    }

    if (action === "get_trace") {
      const runId = String(body.payload?.runId ?? "");
      if (!runId) {
        return c.json({ code: 400, message: "missing runId", data: null }, 400);
      }
      const trace = handleMilocoGetTrace(runId);
      return c.json({ code: 0, message: "ok", data: trace });
    }

    return c.json({ code: 400, message: `unknown action: ${action}`, data: null }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ code: 500, message, data: null }, 500);
  }
});
