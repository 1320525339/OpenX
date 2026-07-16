import type { Hono } from "hono";
import type {
  IntegrationDirectoryEntry,
  IntegrationHealthStatus,
  IntegrationManifest,
} from "@openx/shared";
import { broadcast } from "./sse.js";

/**
 * 第三方集成插件契约。
 * 路由始终注册；禁用时由中间件/路由守卫返回 409。
 */
export type IntegrationPluginContext = {
  env: NodeJS.ProcessEnv;
  openxRoot: string;
};

export type IntegrationDiagnosticsResult = {
  ok: boolean;
  checkedAt: string;
  summary: string;
  checks?: Array<{ id: string; ok: boolean; detail: string }>;
  raw?: unknown;
};

export type IntegrationPlugin = {
  id: string;
  getManifest(ctx: IntegrationPluginContext): IntegrationManifest;
  /** 是否启用（读 Settings + env 覆盖） */
  isEnabled(ctx: IntegrationPluginContext): boolean;
  /** 环境变量是否锁定启用态 */
  isEnvLocked?(ctx: IntegrationPluginContext): { locked: boolean; reason?: string };
  registerRoutes?(app: Hono, ctx: IntegrationPluginContext): void;
  onStartup?(ctx: IntegrationPluginContext): void | Promise<void>;
  startWatchdogs?(ctx: IntegrationPluginContext): void;
  stopWatchdogs?(): void;
  health?(ctx: IntegrationPluginContext): Promise<{ ok: boolean; detail?: string }> | {
    ok: boolean;
    detail?: string;
  };
  /** 后台诊断（single-flight 由生命周期管理器保证） */
  runDiagnostics?(
    ctx: IntegrationPluginContext,
  ): Promise<IntegrationDiagnosticsResult>;
  getLatestDiagnostics?(ctx: IntegrationPluginContext): IntegrationDiagnosticsResult | null;
};

type PluginRuntimeState = {
  health: IntegrationHealthStatus;
  healthDetail?: string;
  started: boolean;
  routesRegistered: boolean;
  diagnosticsRefreshing: boolean;
  latestDiagnostics: IntegrationDiagnosticsResult | null;
};

const registry = new Map<string, IntegrationPlugin>();
const runtimeState = new Map<string, PluginRuntimeState>();
const diagnosticsInflight = new Map<string, Promise<IntegrationDiagnosticsResult>>();

function ensureState(id: string): PluginRuntimeState {
  let s = runtimeState.get(id);
  if (!s) {
    s = {
      health: "disabled",
      started: false,
      routesRegistered: false,
      diagnosticsRefreshing: false,
      latestDiagnostics: null,
    };
    runtimeState.set(id, s);
  }
  return s;
}

export function registerIntegrationPlugin(plugin: IntegrationPlugin): void {
  registry.set(plugin.id, plugin);
  ensureState(plugin.id);
}

export function listIntegrationPlugins(): IntegrationPlugin[] {
  return [...registry.values()];
}

export function getIntegrationPlugin(id: string): IntegrationPlugin | undefined {
  return registry.get(id);
}

export function clearIntegrationPlugins(): void {
  registry.clear();
  runtimeState.clear();
  diagnosticsInflight.clear();
}

export function enabledIntegrationPlugins(
  ctx: IntegrationPluginContext,
): IntegrationPlugin[] {
  return listIntegrationPlugins().filter((p) => p.isEnabled(ctx));
}

export function getIntegrationRuntimeState(id: string): PluginRuntimeState | undefined {
  return runtimeState.get(id);
}

export function isIntegrationRuntimeEnabled(id: string, ctx: IntegrationPluginContext): boolean {
  const plugin = registry.get(id);
  return plugin?.isEnabled(ctx) === true;
}

function emitIntegrationUpdated(
  id: string,
  state: PluginRuntimeState,
  enabled: boolean,
): void {
  broadcast({
    type: "integration.updated",
    integrationId: id,
    enabled,
    health: state.health,
    healthDetail: state.healthDetail,
    diagnosticsRefreshing: state.diagnosticsRefreshing,
    timestamp: new Date().toISOString(),
  });
}

/** 启动单个已启用插件（可热启） */
export async function startIntegrationPlugin(
  plugin: IntegrationPlugin,
  ctx: IntegrationPluginContext,
): Promise<boolean> {
  const state = ensureState(plugin.id);
  if (state.started) return true;
  state.health = "starting";
  try {
    await plugin.onStartup?.(ctx);
    try {
      plugin.startWatchdogs?.(ctx);
    } catch (wdErr) {
      console.warn(
        `[openx] 集成 ${plugin.id} watchdog 启动失败:`,
        wdErr instanceof Error ? wdErr.message : wdErr,
      );
      state.health = "degraded";
      state.healthDetail = wdErr instanceof Error ? wdErr.message : String(wdErr);
    }
    if (state.health !== "degraded") {
      state.health = "ok";
      state.healthDetail = undefined;
    }
    state.started = true;
    emitIntegrationUpdated(plugin.id, state, true);
    return true;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[openx] 集成 ${plugin.id} 启动失败（已隔离）:`, detail);
    state.health = "degraded";
    state.healthDetail = detail;
    state.started = false;
    emitIntegrationUpdated(plugin.id, state, true);
    return false;
  }
}

/** 停止插件 watchdog（已开始的 run 允许结束） */
export function stopIntegrationPlugin(plugin: IntegrationPlugin): void {
  const state = ensureState(plugin.id);
  try {
    plugin.stopWatchdogs?.();
  } catch {
    /* ignore */
  }
  state.started = false;
  state.health = "disabled";
  state.healthDetail = undefined;
  emitIntegrationUpdated(plugin.id, state, false);
}

/**
 * 启动路径：所有插件注册路由；仅对启用的执行 onStartup/watchdogs。
 */
export async function startEnabledIntegrations(
  app: Hono,
  ctx: IntegrationPluginContext,
): Promise<string[]> {
  const started: string[] = [];
  for (const plugin of listIntegrationPlugins()) {
    const state = ensureState(plugin.id);
    if (!state.routesRegistered) {
      try {
        plugin.registerRoutes?.(app, ctx);
        state.routesRegistered = true;
      } catch (err) {
        console.error(
          `[openx] 集成 ${plugin.id} 路由注册失败:`,
          err instanceof Error ? err.message : err,
        );
        state.health = "degraded";
        state.healthDetail = err instanceof Error ? err.message : String(err);
        continue;
      }
    }
    if (!plugin.isEnabled(ctx)) {
      state.health = "disabled";
      state.started = false;
      continue;
    }
    const ok = await startIntegrationPlugin(plugin, ctx);
    if (ok) started.push(plugin.id);
  }
  return started;
}

export function stopAllIntegrations(): void {
  for (const plugin of listIntegrationPlugins()) {
    stopIntegrationPlugin(plugin);
  }
}

/** 运行时启停（Settings 变更后调用） */
export async function setIntegrationEnabled(
  id: string,
  enabled: boolean,
  ctx: IntegrationPluginContext,
): Promise<{ ok: boolean; error?: string; envLocked?: boolean }> {
  const plugin = registry.get(id);
  if (!plugin) return { ok: false, error: "not found" };
  const lock = plugin.isEnvLocked?.(ctx);
  if (lock?.locked) {
    return { ok: false, error: lock.reason ?? "环境变量已锁定", envLocked: true };
  }
  if (enabled) {
    const ok = await startIntegrationPlugin(plugin, ctx);
    return { ok, error: ok ? undefined : "启动失败" };
  }
  stopIntegrationPlugin(plugin);
  return { ok: true };
}

export async function runIntegrationDiagnostics(
  id: string,
  ctx: IntegrationPluginContext,
): Promise<IntegrationDiagnosticsResult | null> {
  const plugin = registry.get(id);
  if (!plugin?.runDiagnostics) return null;
  const existing = diagnosticsInflight.get(id);
  if (existing) return existing;

  const state = ensureState(id);
  state.diagnosticsRefreshing = true;
  emitIntegrationUpdated(id, state, plugin.isEnabled(ctx));

  const promise = (async () => {
    try {
      const result = await plugin.runDiagnostics!(ctx);
      state.latestDiagnostics = result;
      state.health = result.ok ? "ok" : "degraded";
      state.healthDetail = result.summary;
      return result;
    } catch (err) {
      const result: IntegrationDiagnosticsResult = {
        ok: false,
        checkedAt: new Date().toISOString(),
        summary: err instanceof Error ? err.message : String(err),
      };
      state.latestDiagnostics = result;
      state.health = "degraded";
      state.healthDetail = result.summary;
      return result;
    } finally {
      state.diagnosticsRefreshing = false;
      diagnosticsInflight.delete(id);
      emitIntegrationUpdated(id, state, plugin.isEnabled(ctx));
    }
  })();

  diagnosticsInflight.set(id, promise);
  return promise;
}

export async function buildIntegrationsDirectory(
  ctx: IntegrationPluginContext,
): Promise<IntegrationDirectoryEntry[]> {
  const entries: IntegrationDirectoryEntry[] = [];
  for (const plugin of listIntegrationPlugins()) {
    const manifest = plugin.getManifest(ctx);
    const enabled = plugin.isEnabled(ctx);
    const lock = plugin.isEnvLocked?.(ctx);
    const state = ensureState(plugin.id);
    let health: IntegrationHealthStatus = enabled
      ? state.health === "disabled"
        ? "starting"
        : state.health
      : "disabled";
    let healthDetail = state.healthDetail;

    if (enabled && plugin.health && state.started) {
      try {
        const h = await plugin.health(ctx);
        if (!h.ok) {
          health = "degraded";
          healthDetail = h.detail;
        } else if (health === "ok" || health === "starting") {
          health = "ok";
          healthDetail = h.detail ?? healthDetail;
        }
      } catch (err) {
        health = "degraded";
        healthDetail = err instanceof Error ? err.message : String(err);
      }
    }

    entries.push({
      ...manifest,
      installed: true,
      enabled,
      health,
      healthDetail,
      envLocked: lock?.locked,
      envLockReason: lock?.reason,
    });
  }
  return entries;
}

export function collectIntegrationOxspTemplates(
  ctx: IntegrationPluginContext,
): IntegrationManifest["oxspTemplates"] {
  const templates: NonNullable<IntegrationManifest["oxspTemplates"]> = [];
  for (const plugin of enabledIntegrationPlugins(ctx)) {
    const state = runtimeState.get(plugin.id);
    if (state && !state.started && state.health === "degraded") continue;
    const m = plugin.getManifest(ctx);
    if (m.oxspTemplates?.length) templates.push(...m.oxspTemplates);
  }
  return templates;
}
