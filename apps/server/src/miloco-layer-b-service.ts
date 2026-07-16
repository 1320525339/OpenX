import { getMilocoWebhookTokenPath } from "./paths.js";
import { readFileSync, existsSync } from "node:fs";
import {
  MILOCO_DEFAULT_PORT,
  MILOCO_EVENTS_CONVERSATION_ID,
  MILOCO_OXSP_TEMPLATE_ID,
  milocoWebhookUrl,
} from "@openx/shared";
import { createOxspSlot, getDesktopBundle } from "./desktop-service.js";
import { listGoals } from "./db.js";
import { getOrCreateMilocoWebhookToken } from "./miloco-webhook-auth.js";
import {
  parseMilocoCliJson,
  runMilocoWslCliAsync,
  runWslBashAsync,
  type MilocoCliRunResult,
} from "./miloco-cli-runner.js";
import { loadSettings } from "./settings-store.js";

export type MilocoLayerBCheck = {
  id: string;
  ok: boolean;
  detail: string;
};

export type MilocoScopeCamera = {
  did: string;
  name?: string;
  room?: string;
  in_use: boolean;
  is_online: boolean;
  connected: boolean;
};

export type MilocoLayerBStatus = {
  checkedAt: string;
  ready: boolean;
  checks: MilocoLayerBCheck[];
  cameras: MilocoScopeCamera[];
  enabledCameraCount: number;
  maxEnabledCameras: number;
  perceptionDeviceCount: number;
  omniApiKeyConfigured: boolean;
  wslWebhookReachable: boolean;
  wslWebhookUrl?: string;
  dashboardUrl: string;
  eventsConversationId: string;
  recentEventGoalCount: number;
  latestEventGoal?: { id: string; title: string; status: string; updatedAt: string };
};

type CameraListResponse = {
  code?: number;
  data?: Array<Record<string, unknown>>;
};

/** 单次诊断总预算（避免多主机重试拖死后台任务） */
const DIAGNOSIS_BUDGET_MS = 20_000;
const WEBHOOK_PROBE_ATTEMPTS = 1;
const WEBHOOK_HOST_BUDGET_MS = 8_000;

function stripWslNoise(text: string): string {
  return text.replace(/\0/g, "").trim();
}

async function detectWslWindowsHost(): Promise<string | null> {
  const route = await runWslBashAsync(
    "ip route show default 2>/dev/null | awk '{print $3; exit}'",
    { timeoutMs: 8_000 },
  );
  return stripWslNoise(route.stdout).match(/\d+\.\d+\.\d+\.\d+/)?.[0] ?? null;
}

async function testDashboardReachable(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/** 轻量 Pi 就绪检查：不调用 detectExecutors（避免阻塞诊断） */
function checkPiReadyLight(): { ok: boolean; detail: string } {
  if (process.env.OPENX_MOCK_PI === "1") {
    return { ok: true, detail: "Pi mock 模式可用" };
  }
  try {
    const settings = loadSettings();
    const model = settings.model;
    const modelConfigured = Boolean(
      model && (model.pi || model.default || model.coach),
    );
    const providers = settings.providers;
    const hasProvider =
      providers &&
      typeof providers === "object" &&
      Object.keys(providers).length > 0;
    if (modelConfigured || hasProvider) {
      return { ok: true, detail: "Pi 执行器配置已就绪（轻量检查）" };
    }
    return {
      ok: false,
      detail: "未配置 LLM 模型/Provider，Pi 可能不可用",
    };
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : "无法读取 Pi 配置",
    };
  }
}

async function verifyMilocoWebhookConfig(
  port: number,
): Promise<{ ok: boolean; detail: string; configuredUrl?: string }> {
  const tokenPath = getMilocoWebhookTokenPath();
  if (!existsSync(tokenPath)) {
    return { ok: false, detail: "OpenX webhook token 文件不存在" };
  }
  const expectedToken = readFileSync(tokenPath, "utf8").trim();
  const expectedUrl = milocoWebhookUrl("127.0.0.1", port);

  const [urlCli, bearerCli] = await Promise.all([
    runMilocoWslCliAsync(["config", "get", "agent.webhook_url"], { timeoutMs: 20_000 }),
    runMilocoWslCliAsync(["config", "get", "agent.auth_bearer"], { timeoutMs: 20_000 }),
  ]);
  if (!urlCli.ok || !bearerCli.ok) {
    return {
      ok: false,
      detail:
        urlCli.timedOut || bearerCli.timedOut
          ? "读取 WSL webhook 配置超时"
          : "无法读取 WSL agent.webhook_url / agent.auth_bearer",
    };
  }

  const urlJson = parseMilocoCliJson<{ value?: string }>(urlCli.stdout);
  const bearerJson = parseMilocoCliJson<{ value?: string }>(bearerCli.stdout);
  const configuredUrl = (urlJson?.value ?? "").trim().replace(/^"|"$/g, "");
  const configuredBearer = (bearerJson?.value ?? "").trim().replace(/^"|"$/g, "");

  const urlOk =
    configuredUrl === expectedUrl || configuredUrl.includes(`/api/miloco/webhook`);
  const tokenOk = configuredBearer === expectedToken;

  if (urlOk && tokenOk) {
    return { ok: true, detail: `WSL webhook 已配置: ${configuredUrl}`, configuredUrl };
  }
  const parts: string[] = [];
  if (!urlOk) parts.push(`url=${configuredUrl || "(empty)"}`);
  if (!tokenOk) parts.push("bearer 不匹配");
  return { ok: false, detail: parts.join("; "), configuredUrl: configuredUrl || undefined };
}

async function webhookProbeHosts(
  configuredWebhookUrl?: string,
): Promise<string[]> {
  const hosts: string[] = [];
  if (configuredWebhookUrl) {
    try {
      const host = new URL(configuredWebhookUrl).hostname;
      if (host) hosts.push(host);
    } catch {
      /* ignore */
    }
  }
  const gw = await detectWslWindowsHost();
  if (gw && !hosts.includes(gw)) hosts.push(gw);
  if (!hosts.includes("127.0.0.1")) hosts.push("127.0.0.1");
  return hosts;
}

async function curlWslHttpCode(url: string): Promise<string> {
  const cmd = `curl -sS --connect-timeout 5 --max-time 10 -o /dev/null -w '%{http_code}' '${url}' 2>/dev/null || true`;
  const result = await runWslBashAsync(cmd, { timeoutMs: 12_000 });
  const combined = stripWslNoise(`${result.stdout}\n${result.stderr}`);
  return combined.match(/\d{3}/)?.[0] ?? "";
}

async function testWslWebhookReachable(
  port: number,
  configuredWebhookUrl?: string,
): Promise<{ ok: boolean; url?: string }> {
  const hosts = await webhookProbeHosts(configuredWebhookUrl);
  const hostDeadline = Date.now() + WEBHOOK_HOST_BUDGET_MS;

  for (const host of hosts) {
    if (Date.now() > hostDeadline) break;
    const url = milocoWebhookUrl(host, port);
    for (let attempt = 0; attempt < WEBHOOK_PROBE_ATTEMPTS; attempt++) {
      if (Date.now() > hostDeadline) break;
      if ((await curlWslHttpCode(url)) === "200") return { ok: true, url };
      if (attempt < WEBHOOK_PROBE_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }
  const fallbackHost = hosts[0] ?? "127.0.0.1";
  return { ok: false, url: milocoWebhookUrl(fallbackHost, port) };
}

function normalizeCamera(row: Record<string, unknown>): MilocoScopeCamera {
  return {
    did: String(row.did ?? ""),
    name: row.name != null ? String(row.name) : undefined,
    room: row.room != null ? String(row.room) : undefined,
    in_use: row.in_use === true,
    is_online: row.is_online === true,
    connected: row.connected === true,
  };
}

/** 执行一次完整 Layer B 诊断（异步子进程，带总预算） */
export async function probeMilocoLayerBStatus(): Promise<MilocoLayerBStatus> {
  const checkedAt = new Date().toISOString();
  const checks: MilocoLayerBCheck[] = [];
  const port = Number(process.env.PORT ?? MILOCO_DEFAULT_PORT);
  const dashboardUrl = "http://127.0.0.1:1810/";
  const budgetDeadline = Date.now() + DIAGNOSIS_BUDGET_MS;

  const webhookConfig = await verifyMilocoWebhookConfig(port);
  let wslWebhook = await testWslWebhookReachable(port);
  if (!wslWebhook.ok && webhookConfig.configuredUrl && Date.now() < budgetDeadline) {
    wslWebhook = await testWslWebhookReachable(port, webhookConfig.configuredUrl);
  }

  const remainingMs = Math.max(5_000, budgetDeadline - Date.now());
  const cliTimeout = Math.min(25_000, Math.floor(remainingMs / 2));

  const [service, omni, cameraCli, perceiveCli, adminCli, dashboardOk] = await Promise.all([
    runMilocoWslCliAsync(["service", "status"], { timeoutMs: cliTimeout }),
    runMilocoWslCliAsync(["config", "get", "model.omni.api_key"], { timeoutMs: cliTimeout }),
    runMilocoWslCliAsync(["scope", "camera", "list"], { timeoutMs: cliTimeout }),
    runMilocoWslCliAsync(["perceive", "devices"], { timeoutMs: cliTimeout }),
    runMilocoWslCliAsync(["admin", "status"], { timeoutMs: cliTimeout }),
    testDashboardReachable(dashboardUrl),
  ]);

  const piCheck = checkPiReadyLight();

  checks.push({
    id: "miloco_service",
    ok: service.ok,
    detail: service.ok
      ? "miloco-cli service 运行中"
      : service.stderr || service.stdout || "service 不可用",
  });

  const omniVal = omni.stdout.replace(/^.*?:\s*/s, "").trim();
  const omniApiKeyConfigured =
    omni.ok && omniVal.length > 0 && omniVal !== "null" && omniVal !== '""';
  checks.push({
    id: "omni_api_key",
    ok: omniApiKeyConfigured,
    detail: omniApiKeyConfigured
      ? "model.omni.api_key 已配置"
      : "未配置 model.omni.api_key（感知引擎不可用）",
  });

  checks.push({
    id: "wsl_webhook",
    ok: wslWebhook.ok,
    detail: wslWebhook.ok
      ? `WSL 可访问 ${wslWebhook.url}`
      : `WSL 无法 curl OpenX webhook（请运行接入向导或配置回调）`,
  });

  checks.push({
    id: "miloco_webhook_config",
    ok: webhookConfig.ok,
    detail: webhookConfig.detail,
  });

  checks.push({
    id: "dashboard_reachable",
    ok: dashboardOk,
    detail: dashboardOk
      ? `Dashboard 可达 ${dashboardUrl}`
      : `Dashboard 不可达 ${dashboardUrl}（Miloco 服务或端口转发）`,
  });

  checks.push({
    id: "pi_executor",
    ok: piCheck.ok,
    detail: piCheck.detail,
  });

  const cameraJson = parseMilocoCliJson<CameraListResponse>(cameraCli.stdout);
  const cameraRows = Array.isArray(cameraJson?.data) ? cameraJson.data : [];
  const cameras = cameraRows.map(normalizeCamera).filter((c) => c.did);
  const enabledCameraCount = cameras.filter((c) => c.in_use).length;
  const readyCameras = cameras.filter((c) => c.in_use && c.is_online && c.connected);

  checks.push({
    id: "scope_cameras",
    ok: cameraCli.ok,
    detail: cameraCli.ok
      ? `共 ${cameras.length} 路摄像头，${enabledCameraCount} 路 in_use，${readyCameras.length} 路就绪（in_use+online+connected）`
      : cameraCli.stderr || cameraCli.stdout || "scope camera list 失败",
  });
  const perceiveJson = parseMilocoCliJson<{ data?: unknown[] }>(perceiveCli.stdout);
  const perceptionDevices = Array.isArray(perceiveJson?.data) ? perceiveJson.data : [];
  checks.push({
    id: "perceive_devices",
    ok: perceiveCli.ok,
    detail: perceiveCli.ok
      ? `感知设备 ${perceptionDevices.length} 个`
      : perceiveCli.stderr || perceiveCli.stdout || "perceive devices 失败",
  });
  checks.push({
    id: "admin_status",
    ok: adminCli.ok,
    detail: adminCli.ok
      ? "admin status 可读"
      : adminCli.stderr || adminCli.stdout || "admin status 失败",
  });

  const eventGoals = listGoals({ conversationId: MILOCO_EVENTS_CONVERSATION_ID });
  const latest = eventGoals.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  checks.push({
    id: "events_conversation",
    ok: true,
    detail: `openx-miloco-events 共 ${eventGoals.length} 个 Goal`,
  });

  const layerBReady =
    service.ok &&
    omniApiKeyConfigured &&
    wslWebhook.ok &&
    webhookConfig.ok &&
    piCheck.ok &&
    readyCameras.length > 0;

  return {
    checkedAt,
    ready: layerBReady,
    checks,
    cameras,
    enabledCameraCount,
    maxEnabledCameras: 4,
    perceptionDeviceCount: perceptionDevices.length,
    omniApiKeyConfigured,
    wslWebhookReachable: wslWebhook.ok,
    wslWebhookUrl: wslWebhook.url,
    dashboardUrl,
    eventsConversationId: MILOCO_EVENTS_CONVERSATION_ID,
    recentEventGoalCount: eventGoals.length,
    latestEventGoal: latest
      ? {
          id: latest.id,
          title: latest.title,
          status: latest.status,
          updatedAt: latest.updatedAt,
        }
      : undefined,
  };
}

/** @deprecated 使用 probeMilocoLayerBStatus；保留别名兼容旧调用 */
export async function getMilocoLayerBStatus(): Promise<MilocoLayerBStatus> {
  return probeMilocoLayerBStatus();
}

export async function enableMilocoScopeCameras(dids: string[]): Promise<MilocoCliRunResult> {
  if (!dids.length) return { ok: false, status: 1, stdout: "", stderr: "missing dids" };
  return runMilocoWslCliAsync(["scope", "camera", "enable", ...dids]);
}

export async function disableMilocoScopeCameras(dids: string[]): Promise<MilocoCliRunResult> {
  if (!dids.length) return { ok: false, status: 1, stdout: "", stderr: "missing dids" };
  return runMilocoWslCliAsync(["scope", "camera", "disable", ...dids]);
}

export async function connectMilocoWebhookWsl(
  webhookHost = "127.0.0.1",
  port = Number(process.env.PORT ?? MILOCO_DEFAULT_PORT),
): Promise<{ ok: boolean; webhookUrl: string; error?: string }> {
  getOrCreateMilocoWebhookToken();
  const tokenPath = getMilocoWebhookTokenPath();
  if (!existsSync(tokenPath)) {
    return { ok: false, webhookUrl: milocoWebhookUrl(webhookHost, port), error: "webhook token missing" };
  }
  const token = readFileSync(tokenPath, "utf8").trim();
  const webhookUrl = milocoWebhookUrl(webhookHost, port);

  for (const args of [
    ["config", "set", "agent.webhook_url", webhookUrl],
    ["config", "set", "agent.auth_bearer", token],
  ]) {
    const res = await runMilocoWslCliAsync(args, { timeoutMs: 30_000 });
    if (!res.ok) {
      return { ok: false, webhookUrl, error: res.stderr || res.stdout || "config set failed" };
    }
  }
  return { ok: true, webhookUrl };
}

export function addMilocoDashboardCard(): {
  ok: boolean;
  slotId?: string;
  existing?: boolean;
  error?: string;
  needsConfig?: boolean;
} {
  const scope = "console" as const;
  const bundle = getDesktopBundle(scope);
  const existing = bundle.catalog.slots?.find(
    (s) =>
      s.config?.kind === "browser" &&
      "startUrl" in s.config &&
      String(s.config.startUrl).includes(":1810"),
  );
  if (existing) {
    return { ok: true, slotId: existing.id, existing: true };
  }
  if (!bundle.templates.some((t) => t.id === MILOCO_OXSP_TEMPLATE_ID)) {
    return {
      ok: false,
      needsConfig: true,
      error: "Miloco 集成未启用或未就绪，请先完成接入向导",
    };
  }
  try {
    const { slotId } = createOxspSlot(scope, {
      kind: "browser",
      templateId: MILOCO_OXSP_TEMPLATE_ID,
      title: "Miloco 面板",
      pinCol: 1,
    });
    return { ok: true, slotId, existing: false };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
