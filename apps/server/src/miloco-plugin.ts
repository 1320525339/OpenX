import type { Hono } from "hono";
import {
  MILOCO_OXSP_TEMPLATE_ID,
  MILOCO_SYNC_SKILL_IDS,
  type IntegrationManifest,
} from "@openx/shared";
import type { IntegrationPlugin } from "./integration-plugin.js";
import { milocoRoutes } from "./routes/miloco.js";
import { ensureMilocoIntegrationOnStartup } from "./miloco-skills-service.js";
import {
  startMilocoPresenceWatchdog,
  stopMilocoPresenceWatchdog,
} from "./miloco-presence-watchdog.js";
import {
  startMilocoHomeCronWatchdog,
  stopMilocoHomeCronWatchdog,
} from "./miloco-home-cron-watchdog.js";
import {
  startMilocoLayerBWatchdog,
  stopMilocoLayerBWatchdog,
  getCachedMilocoLayerBStatus,
  refreshMilocoLayerBStatus,
} from "./miloco-layer-b-cache.js";
import { migrateMilocoAwaitingReviewGoals } from "./miloco-webhook-service.js";
import {
  resolveMilocoEnabled,
} from "./miloco-integration-settings.js";
import { pruneIntegrationRuns } from "./integration-run-store.js";
import { loadSettings } from "./settings-store.js";

const MILOCO_MANIFEST: IntegrationManifest = {
  id: "miloco",
  version: "1.1.0",
  displayName: "Miloco 智能家居",
  icon: "🏠",
  capabilities: [
    "webhook",
    "device-control",
    "perception",
    "cron",
    "presence",
    "oxsp-dashboard",
    "diagnostics",
  ],
  permissions: ["wsl-cli", "webhook-inbound", "pi-dispatch"],
  routes: [
    { method: "GET", path: "/api/miloco/status", summary: "集成状态" },
    { method: "GET", path: "/api/miloco/layer-b", summary: "Layer B 缓存诊断" },
    { method: "POST", path: "/api/miloco/webhook", summary: "感知事件入站" },
    { method: "GET", path: "/api/miloco/events", summary: "自动化运行时间线" },
  ],
  skills: MILOCO_SYNC_SKILL_IDS.map((id) => ({ id })),
  oxspTemplates: [
    {
      id: MILOCO_OXSP_TEMPLATE_ID,
      label: "Miloco 面板",
      icon: "🏠",
      kind: "browser",
      defaultConfig: { kind: "browser", startUrl: "http://127.0.0.1:1810/" },
    },
  ],
  toolsTab: {
    id: "miloco",
    label: "Miloco",
    componentKey: "ToolsMilocoTab",
  },
};

export const milocoIntegrationPlugin: IntegrationPlugin = {
  id: "miloco",

  getManifest() {
    return MILOCO_MANIFEST;
  },

  isEnabled() {
    return resolveMilocoEnabled().enabled;
  },

  isEnvLocked() {
    const r = resolveMilocoEnabled();
    return { locked: r.envLocked, reason: r.reason };
  },

  registerRoutes(app: Hono) {
    app.route("/api/miloco", milocoRoutes);
  },

  onStartup() {
    ensureMilocoIntegrationOnStartup();
    try {
      const n = migrateMilocoAwaitingReviewGoals();
      if (n > 0) console.log(`[miloco] 已清理 ${n} 个历史待验收感知 Goal`);
    } catch (err) {
      console.warn(
        "[miloco] 清理历史待验收 Goal 失败:",
        err instanceof Error ? err.message : err,
      );
    }
    try {
      pruneIntegrationRuns("miloco");
    } catch {
      /* ignore */
    }
  },

  startWatchdogs() {
    startMilocoLayerBWatchdog();
    startMilocoPresenceWatchdog();
    startMilocoHomeCronWatchdog();
  },

  stopWatchdogs() {
    stopMilocoLayerBWatchdog();
    stopMilocoPresenceWatchdog();
    stopMilocoHomeCronWatchdog();
  },

  health() {
    const cached = getCachedMilocoLayerBStatus();
    if (!cached.checkedAt) {
      return { ok: true, detail: "miloco 已加载（诊断尚未完成）" };
    }
    if (cached.error) {
      return { ok: false, detail: cached.error };
    }
    return {
      ok: cached.ready,
      detail: cached.ready
        ? `Layer B 就绪 · ${cached.checkedAt}`
        : `Layer B 未就绪 · ${cached.checkedAt}`,
    };
  },

  async runDiagnostics() {
    const status = await refreshMilocoLayerBStatus(true);
    return {
      ok: status.ready,
      checkedAt: status.checkedAt,
      summary: status.ready ? "Layer B 就绪" : "Layer B 未就绪",
      checks: status.checks,
      raw: status,
    };
  },

  getLatestDiagnostics() {
    const cached = getCachedMilocoLayerBStatus();
    if (!cached.checkedAt) return null;
    return {
      ok: cached.ready,
      checkedAt: cached.checkedAt,
      summary: cached.ready ? "Layer B 就绪" : cached.error ?? "Layer B 未就绪",
      checks: cached.checks,
      raw: cached,
    };
  },
};

/** 供路由守卫使用 */
export function assertMilocoEnabled(): { ok: true } | { ok: false; reason: string } {
  const r = resolveMilocoEnabled(loadSettings());
  if (!r.enabled) {
    return { ok: false, reason: r.reason ?? "integration_disabled" };
  }
  return { ok: true };
};
