import { Hono } from "hono";
import {
  buildIntegrationsDirectory,
  collectIntegrationOxspTemplates,
  getIntegrationPlugin,
  runIntegrationDiagnostics,
  setIntegrationEnabled,
  type IntegrationPluginContext,
} from "../integration-plugin.js";
import { loadSettings, saveSettings } from "../settings-store.js";
import { migrateMilocoIntegrationSettings } from "../miloco-integration-settings.js";

export const integrationsRoutes = new Hono();

function pluginCtx(): IntegrationPluginContext {
  return {
    env: process.env,
    openxRoot: process.env.OPENX_ROOT ?? "",
  };
}

integrationsRoutes.get("/", async (c) => {
  const integrations = await buildIntegrationsDirectory(pluginCtx());
  return c.json({ integrations });
});

integrationsRoutes.get("/oxsp-templates", (c) => {
  const templates = collectIntegrationOxspTemplates(pluginCtx()) ?? [];
  return c.json({ templates });
});

integrationsRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const list = await buildIntegrationsDirectory(pluginCtx());
  const entry = list.find((e) => e.id === id);
  if (!entry) return c.json({ ok: false, error: "not found" }, 404);
  const settings = loadSettings();
  const user = settings.integrations?.[id];
  return c.json({
    ...entry,
    migrationCompleted: user?.migrationCompleted ?? false,
    config: user?.config ?? {},
  });
});

integrationsRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const plugin = getIntegrationPlugin(id);
  if (!plugin) return c.json({ ok: false, error: "not found" }, 404);

  const body = (await c.req.json().catch(() => ({}))) as {
    enabled?: boolean;
    config?: Record<string, unknown>;
  };
  const ctx = pluginCtx();
  const settings = loadSettings();
  const prev = settings.integrations?.[id] ?? {
    enabled: false,
    migrationCompleted: true,
    config: {},
  };

  if (typeof body.enabled === "boolean") {
    const result = await setIntegrationEnabled(id, body.enabled, ctx);
    if (!result.ok) {
      return c.json(
        { ok: false, error: result.error, envLocked: result.envLocked },
        result.envLocked ? 409 : 500,
      );
    }
  }

  const nextEnabled =
    typeof body.enabled === "boolean" ? body.enabled : prev.enabled;
  const next = {
    ...settings,
    integrations: {
      ...(settings.integrations ?? {}),
      [id]: {
        enabled: nextEnabled,
        migrationCompleted: prev.migrationCompleted || true,
        config: {
          ...(prev.config ?? {}),
          ...(body.config ?? {}),
        },
      },
    },
  };
  saveSettings(next);

  // 若仅改 config 且已启用，确保 watchdog 在跑
  if (nextEnabled) {
    await setIntegrationEnabled(id, true, ctx);
  }

  const list = await buildIntegrationsDirectory(ctx);
  const entry = list.find((e) => e.id === id);
  return c.json({ ok: true, integration: entry });
});

integrationsRoutes.post("/:id/diagnostics", async (c) => {
  const id = c.req.param("id");
  if (!getIntegrationPlugin(id)) {
    return c.json({ ok: false, error: "not found" }, 404);
  }
  const result = await runIntegrationDiagnostics(id, pluginCtx());
  if (!result) {
    return c.json({ ok: false, error: "diagnostics not supported" }, 400);
  }
  return c.json(result);
});

integrationsRoutes.get("/:id/diagnostics/latest", async (c) => {
  const id = c.req.param("id");
  const plugin = getIntegrationPlugin(id);
  if (!plugin) return c.json({ ok: false, error: "not found" }, 404);
  const latest = plugin.getLatestDiagnostics?.(pluginCtx()) ?? null;
  if (!latest) {
    return c.json({ ok: false, error: "no diagnostics yet" }, 404);
  }
  return c.json(latest);
});

integrationsRoutes.get("/:id/health", async (c) => {
  const id = c.req.param("id");
  const list = await buildIntegrationsDirectory(pluginCtx());
  const entry = list.find((e) => e.id === id);
  if (!entry) return c.json({ ok: false, error: "not found" }, 404);
  return c.json({
    ok: entry.health === "ok",
    health: entry.health,
    detail: entry.healthDetail,
    enabled: entry.enabled,
    envLocked: entry.envLocked,
    envLockReason: entry.envLockReason,
  });
});

/** 启动时调用迁移（避免循环依赖放在路由模块旁路导出） */
export function ensureIntegrationsMigrated(): void {
  migrateMilocoIntegrationSettings();
}
