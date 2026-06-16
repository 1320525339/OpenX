import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import { handleBrowserWebSocket } from "./browser-bridge.js";

const WS_PATH_RE = /^\/api\/desktop\/browser\/([^/]+)\/ws$/;

export function attachBrowserWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const host = req.headers.host ?? "127.0.0.1";
    let pathname: string;
    let startUrl: string | undefined;
    try {
      const url = new URL(req.url ?? "/", `http://${host}`);
      pathname = url.pathname;
      startUrl = url.searchParams.get("startUrl") ?? undefined;
    } catch {
      socket.destroy();
      return;
    }

    const match = pathname.match(WS_PATH_RE);
    if (!match) {
      socket.destroy();
      return;
    }

    const sessionId = decodeURIComponent(match[1]!);
    wss.handleUpgrade(req, socket, head, (ws) => {
      void handleBrowserWebSocket(ws, sessionId, startUrl);
    });
  });
}
