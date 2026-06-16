import type { WebSocket } from "ws";
import type { BrowserClientMessage, BrowserScreenshotMessage, BrowserServerMessage } from "@openx/shared";
import {
  dispatchBrowserAction,
  ensureBrowserSession,
  getBrowserViewport,
  getSessionPageMeta,
  pushBrowserScreenshot,
  subscribeBrowserFrames,
} from "./browser-session.js";

function sendJson(ws: WebSocket, msg: BrowserServerMessage): void {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(msg));
}

function sendScreenshot(ws: WebSocket, msg: BrowserScreenshotMessage, jpeg?: Buffer): void {
  if (ws.readyState !== ws.OPEN) return;
  if (jpeg && msg.encoding === "binary") {
    ws.send(JSON.stringify(msg));
    ws.send(jpeg);
    return;
  }
  ws.send(JSON.stringify(msg));
}

export async function handleBrowserWebSocket(
  ws: WebSocket,
  sessionId: string,
  startUrl?: string,
): Promise<void> {
  let closed = false;
  const close = () => {
    closed = true;
  };
  ws.on("close", close);
  ws.on("error", close);

  try {
    const session = await ensureBrowserSession(sessionId, startUrl);
    const viewport = getBrowserViewport(sessionId);
    const meta = await getSessionPageMeta(sessionId);

    const unsub = subscribeBrowserFrames(sessionId, (frame, jpeg) => {
      if (!closed) sendScreenshot(ws, frame, jpeg);
    });

    ws.on("close", () => unsub());

    sendJson(ws, {
      type: "ready",
      viewport,
      url: session.url,
      title: meta.title,
      mock: session.mock,
    });

    pushBrowserScreenshot(sessionId);

    ws.on("message", (raw) => {
      void (async () => {
        if (closed) return;
        let parsed: BrowserClientMessage;
        try {
          parsed = JSON.parse(String(raw)) as BrowserClientMessage;
        } catch {
          sendJson(ws, { type: "error", message: "invalid_json" });
          return;
        }

        if (parsed.type === "hello") return;

        if (parsed.type !== "action") {
          sendJson(ws, { type: "error", message: "unknown_message_type" });
          return;
        }

        try {
          const dispatchResult = await dispatchBrowserAction(sessionId, parsed.action);
          const pageMeta = await getSessionPageMeta(sessionId);
          sendJson(ws, {
            type: "page",
            url: pageMeta.url,
            title: pageMeta.title,
            loading: false,
          });
          if (dispatchResult?.find) {
            sendJson(ws, { type: "findResult", ...dispatchResult.find });
          }
          sendJson(ws, { type: "ack", id: parsed.id });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          sendJson(ws, { type: "error", id: parsed.id, message });
        }
      })();
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(ws, { type: "error", message });
    ws.close();
  }
}
