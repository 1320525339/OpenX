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
import { getDb, resetDb } from "./db.js";
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

registerEventWebhookHandler((event, payload) => {
  if (event === "goal_failed") {
    console.log(`[openx] 任务失败 ${payload.goalId}: ${payload.errorMessage}`);
  }
});

const port = Number(process.env.PORT ?? 3921);
const host = process.env.HOST ?? "127.0.0.1";

console.log(`OpenX server http://${host}:${port}`);

loadOpenxDotEnv();
runSettingsMigrations();
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

function shutdown(signal: string) {
  console.log(`[openx] ${signal}，正在关闭…`);
  stopConnectWatchdog();
  stopPiWatchdog();
  stopAcpWatchdog();
  stopKnowledgeDistillWatchdog();
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

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
