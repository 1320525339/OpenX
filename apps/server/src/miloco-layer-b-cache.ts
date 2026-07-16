import { existsSync, mkdirSync, readFileSync } from "node:fs";
import {
  probeMilocoLayerBStatus,
  type MilocoLayerBStatus,
} from "./miloco-layer-b-service.js";
import { broadcast } from "./sse.js";
import { getMilocoLayerBCachePath, getOpenxHome } from "./paths.js";
import { atomicWriteJson } from "./atomic-json.js";

export type MilocoLayerBCachedStatus = MilocoLayerBStatus & {
  refreshing: boolean;
  stale: boolean;
  error?: string;
};

function cachePath(): string {
  return getMilocoLayerBCachePath();
}

const EMPTY_STATUS = (): MilocoLayerBStatus => ({
  checkedAt: "",
  ready: false,
  checks: [],
  cameras: [],
  enabledCameraCount: 0,
  maxEnabledCameras: 4,
  perceptionDeviceCount: 0,
  omniApiKeyConfigured: false,
  wslWebhookReachable: false,
  dashboardUrl: "http://127.0.0.1:1810/",
  eventsConversationId: "openx-miloco-events",
  recentEventGoalCount: 0,
});

/** 缓存新鲜度：60 秒 */
export const MILOCO_LAYER_B_STALE_MS = 60_000;
export const MILOCO_LAYER_B_REFRESH_INTERVAL_MS = 60_000;

let cached: MilocoLayerBStatus | null = null;
let lastError: string | undefined;
let refreshing = false;
let refreshPromise: Promise<MilocoLayerBStatus> | null = null;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

function loadPersisted(): void {
  if (cached || !existsSync(cachePath())) return;
  try {
    const parsed = JSON.parse(readFileSync(cachePath(), "utf8")) as MilocoLayerBStatus;
    if (parsed?.checkedAt) cached = parsed;
  } catch {
    /* ignore */
  }
}

function persist(status: MilocoLayerBStatus): void {
  try {
    mkdirSync(getOpenxHome(), { recursive: true });
    // 不持久化可能含敏感信息的超长 detail
    const safe = {
      ...status,
      checks: status.checks.map((c) => ({
        id: c.id,
        ok: c.ok,
        detail: c.detail.slice(0, 240),
      })),
    };
    atomicWriteJson(cachePath(), safe);
  } catch {
    /* ignore */
  }
}

function wrapCached(status: MilocoLayerBStatus | null): MilocoLayerBCachedStatus {
  const base = status ?? EMPTY_STATUS();
  const checkedMs = base.checkedAt ? Date.parse(base.checkedAt) : 0;
  const stale =
    !base.checkedAt ||
    !Number.isFinite(checkedMs) ||
    Date.now() - checkedMs > MILOCO_LAYER_B_STALE_MS;
  return {
    ...base,
    refreshing,
    stale,
    ...(lastError ? { error: lastError } : {}),
  };
}

export function getCachedMilocoLayerBStatus(): MilocoLayerBCachedStatus {
  loadPersisted();
  return wrapCached(cached);
}

export function refreshMilocoLayerBStatus(force = false): Promise<MilocoLayerBStatus> {
  if (refreshPromise && !force) return refreshPromise;

  refreshing = true;
  broadcast({
    type: "integration.updated",
    integrationId: "miloco",
    enabled: true,
    health: "starting",
    diagnosticsRefreshing: true,
    timestamp: new Date().toISOString(),
  });

  const run = (async () => {
    try {
      const status = await probeMilocoLayerBStatus();
      cached = status;
      lastError = undefined;
      persist(status);
      broadcast({
        type: "integration.updated",
        integrationId: "miloco",
        enabled: true,
        health: status.ready ? "ok" : "degraded",
        healthDetail: status.ready ? "Layer B 就绪" : "Layer B 未就绪",
        diagnosticsRefreshing: false,
        timestamp: new Date().toISOString(),
      });
      return status;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (!cached) {
        cached = {
          ...EMPTY_STATUS(),
          checkedAt: new Date().toISOString(),
          checks: [
            {
              id: "diagnosis_error",
              ok: false,
              detail: lastError,
            },
          ],
        };
      }
      broadcast({
        type: "integration.updated",
        integrationId: "miloco",
        enabled: true,
        health: "degraded",
        healthDetail: lastError,
        diagnosticsRefreshing: false,
        timestamp: new Date().toISOString(),
      });
      return cached;
    } finally {
      refreshing = false;
      refreshPromise = null;
    }
  })();

  refreshPromise = run;
  return run;
}

export function startMilocoLayerBWatchdog(): void {
  if (intervalHandle) return;
  loadPersisted();
  void refreshMilocoLayerBStatus();
  intervalHandle = setInterval(() => {
    void refreshMilocoLayerBStatus();
  }, MILOCO_LAYER_B_REFRESH_INTERVAL_MS);
  intervalHandle.unref?.();
}

export function stopMilocoLayerBWatchdog(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

export function resetMilocoLayerBCacheForTests(): void {
  stopMilocoLayerBWatchdog();
  cached = null;
  lastError = undefined;
  refreshing = false;
  refreshPromise = null;
}
