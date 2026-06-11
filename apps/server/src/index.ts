import { serve } from "@hono/node-server";
import { app } from "./routes.js";
import { ensureBuiltinSkillsOnStartup } from "./skills-service.js";
import { ensureBuiltinAgentsOnStartup } from "./agents-service.js";
import { startConnectWatchdog, stopConnectWatchdog } from "./connect-watchdog.js";
import { startAcpWatchdog, stopAcpWatchdog } from "./acp-watchdog.js";
import { startPiWatchdog, stopPiWatchdog } from "./pi-watchdog.js";
import { getDb, resetDb } from "./db.js";

const port = Number(process.env.PORT ?? 3921);
const host = process.env.HOST ?? "127.0.0.1";

console.log(`OpenX server http://${host}:${port}`);

ensureBuiltinSkillsOnStartup();
ensureBuiltinAgentsOnStartup();
if (!process.env.OPENX_PI_WORKER && process.env.OPENX_MOCK_PI !== "1") {
  process.env.OPENX_PI_WORKER = "1";
}
startConnectWatchdog();
startPiWatchdog();
startAcpWatchdog();

const server = serve({ fetch: app.fetch, port, hostname: host });

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
  try {
    getDb().close();
  } catch {
    /* ignore */
  }
  resetDb();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
