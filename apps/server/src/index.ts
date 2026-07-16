import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
process.env.OPENX_ROOT = process.env.OPENX_ROOT ?? resolve(SERVER_DIR, "../../..");

import { serve } from "@hono/node-server";
import { app } from "./routes.js";
import type { Server as HttpServer } from "node:http";
import { attachBrowserWebSocket } from "./browser-ws.js";
import { ensureBuiltinSkillsOnStartup } from "./skills-service.js";
import { ensureBuiltinAgentsOnStartup } from "./agents-service.js";
import { startConnectWatchdog, stopConnectWatchdog } from "./connect-watchdog.js";
import { startAcpWatchdog, stopAcpWatchdog } from "./acp-watchdog.js";
import { startPiWatchdog, stopPiWatchdog } from "./pi-watchdog.js";
import {
  startKnowledgeDistillWatchdog,
  stopKnowledgeDistillWatchdog,
} from "./knowledge-distill-watchdog.js";
import { getDb, getDbIntegrityStatus, resetDb } from "./db.js";
import {
  rebootstrapOfflineConnectProfiles,
  warnIfConnectClientMissing,
} from "./cli-bootstrap.js";
import { loadOpenxDotEnv } from "./openx-dotenv.js";
import { loadSettings, runSettingsMigrations } from "./settings-store.js";
import { closeAllBrowserSessions } from "./browser-session.js";
import { startKnowledgeIndexStartupCheck } from "./knowledge-index-startup.js";
import { shutdownZvecKnowledgeIndex } from "./zvec-knowledge-index.js";
import { registerEventWebhookHandler } from "./event-webhook.js";
import { validateRuntimeBind } from "./runtime-mode.js";
import {
  registerIntegrationPlugin,
  startEnabledIntegrations,
  stopAllIntegrations,
} from "./integration-plugin.js";
import { milocoIntegrationPlugin } from "./miloco-plugin.js";

registerEventWebhookHandler((event, payload) => {
  if (event === "goal_failed") {
    console.log(`[openx] 任务失败 ${payload.goalId}: ${payload.errorMessage}`);
  }
});

loadOpenxDotEnv();

const bind = validateRuntimeBind();
if (!bind.ok) {
  console.error(`[openx] 启动中止：${bind.error}`);
  process.exit(1);
}
const { host, port, mode } = bind.config;

console.log(`OpenX server http://${host}:${port} (${mode})`);

registerIntegrationPlugin(milocoIntegrationPlugin);

function shutdown(signal: string) {
  console.log(`[openx] ${signal}，正在关闭…`);
  stopConnectWatchdog();
  stopPiWatchdog();
  stopAcpWatchdog();
  stopKnowledgeDistillWatchdog();
  stopAllIntegrations();
  void closeAllBrowserSessions().finally(() => {
    try {
      getDb().close();
    } catch {
      /* ignore */
    }
    resetDb();
    shutdownZvecKnowledgeIndex();
    process.exit(0);
  });
}

async function main() {
  runSettingsMigrations();
  getDb();
  const integrity = getDbIntegrityStatus();
  if (integrity.ok === false) {
    console.error(
      `[openx] 数据库完整性检查失败: ${integrity.message}。请使用 /api/system/persistence/backup 备份后排查，或从备份恢复。`,
    );
  } else if (integrity.ok === true) {
    console.log("[openx] 数据库完整性检查通过");
  }
  try {
    const { ensureIntegrationsMigrated } = await import("./routes/integrations.js");
    ensureIntegrationsMigrated();
  } catch (err) {
    console.warn(
      "[openx] 集成迁移跳过:",
      err instanceof Error ? err.message : err,
    );
  }
  ensureBuiltinSkillsOnStartup();
  ensureBuiltinAgentsOnStartup();
  warnIfConnectClientMissing();
  rebootstrapOfflineConnectProfiles(loadSettings());
  if (!process.env.OPENX_PI_WORKER && process.env.OPENX_MOCK_PI !== "1") {
    process.env.OPENX_PI_WORKER = "1";
  }
  startConnectWatchdog();
  startPiWatchdog();
  startAcpWatchdog();
  startKnowledgeDistillWatchdog();
  startKnowledgeIndexStartupCheck();

  const startedPlugins = await startEnabledIntegrations(app, {
    env: process.env,
    openxRoot: process.env.OPENX_ROOT!,
  });
  if (startedPlugins.length > 0) {
    console.log(`[openx] 已加载集成插件：${startedPlugins.join(", ")}`);
  }

  const server = serve({ fetch: app.fetch, port, hostname: host });
  attachBrowserWebSocket(server as HttpServer);

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`端口 ${port} 已被占用。请先结束旧进程，或设置 PORT 环境变量。`);
      process.exit(1);
    }
    console.error(err);
    process.exit(1);
  });

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

void main().catch((err) => {
  console.error("[openx] 启动失败:", err);
  process.exit(1);
});
