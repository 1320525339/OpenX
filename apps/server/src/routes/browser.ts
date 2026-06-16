import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  browserDomSnapshot,
  browserNetworkLog,
  dispatchBrowserAction,
  ensureBrowserSession,
  getBrowserFrame,
  pushBrowserScreenshot,
  subscribeBrowserFrames,
} from "../browser-session.js";
import { legacyClickAction } from "../browser-cdp-input.js";

export const browserRoutes = new Hono();

type BrowserInput =
  | { type: "click"; x: number; y: number }
  | { type: "type"; text: string };

function parseBrowserInput(raw: unknown): BrowserInput {
  if (!raw || typeof raw !== "object") throw new Error("INVALID_BODY");
  const body = raw as Record<string, unknown>;
  if (body.type === "click") {
    if (typeof body.x !== "number" || typeof body.y !== "number") throw new Error("INVALID_CLICK");
    return { type: "click", x: body.x, y: body.y };
  }
  if (body.type === "type") {
    if (typeof body.text !== "string" || body.text.length === 0) throw new Error("INVALID_TYPE");
    return { type: "type", text: body.text };
  }
  throw new Error("INVALID_BODY");
}

function browserErrorResponse(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === "CHROME_NOT_FOUND" || msg === "BROWSER_LAUNCH_FAILED") {
    return {
      status: 503 as const,
      body: {
        ok: false,
        error: msg === "CHROME_NOT_FOUND" ? "chrome_not_found" : "browser_launch_failed",
        hint: "请安装 Chrome/Edge 或设置 OPENX_CHROME_PATH；也可设 OPENX_BROWSER_MOCK=1",
      },
    };
  }
  if (msg === "BROWSER_SESSION_NOT_READY") {
    return {
      status: 503 as const,
      body: { ok: false, error: "session_not_ready" },
    };
  }
  return {
    status: 500 as const,
    body: { ok: false, error: "browser_internal_error", message: msg },
  };
}

/** CDP screencast 帧（Web 轮询 / LLM snapshot 辅助） */
browserRoutes.get("/:sessionId/frame", async (c) => {
  const sessionId = c.req.param("sessionId");
  const startUrl = c.req.query("startUrl") ?? undefined;
  try {
    const frame = await getBrowserFrame(sessionId, startUrl);
    return c.json({ ok: true, ...frame });
  } catch (err) {
    const { status, body } = browserErrorResponse(err);
    return c.json(body, status);
  }
});

/** 确保会话存在（懒启动） */
browserRoutes.post("/:sessionId/ensure", async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = (await c.req.json().catch(() => ({}))) as { startUrl?: string };
  try {
    const session = await ensureBrowserSession(sessionId, body.startUrl);
    return c.json({ ok: true, ...session });
  } catch (err) {
    const { status, body: errBody } = browserErrorResponse(err);
    return c.json(errBody, status);
  }
});

/** browserd 式 SSE 推帧（WebSocket 不可用时的降级） */
browserRoutes.get("/:sessionId/stream", async (c) => {
  const sessionId = c.req.param("sessionId");
  const startUrl = c.req.query("startUrl") ?? undefined;
  try {
    await ensureBrowserSession(sessionId, startUrl);
    return streamSSE(c, async (stream) => {
      let closed = false;
      const unsub = subscribeBrowserFrames(sessionId, async (frame) => {
        if (closed) return;
        await stream.writeSSE({ data: JSON.stringify(frame) });
      });
      pushBrowserScreenshot(sessionId);
      await new Promise<void>((resolve) => {
        const signal = c.req.raw.signal;
        if (signal?.aborted) {
          resolve();
          return;
        }
        signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      closed = true;
      unsub();
    });
  } catch (err) {
    const { status, body } = browserErrorResponse(err);
    return c.json(body, status);
  }
});

/** LLM / 调试：DOM 快照 */
browserRoutes.get("/:sessionId/dom", async (c) => {
  const sessionId = c.req.param("sessionId");
  try {
    const dom = await browserDomSnapshot(sessionId);
    return c.json({ ok: true, dom });
  } catch (err) {
    const { status, body } = browserErrorResponse(err);
    return c.json(body, status);
  }
});

/** LLM / 调试：最近网络请求 */
browserRoutes.get("/:sessionId/network", async (c) => {
  const sessionId = c.req.param("sessionId");
  try {
    await ensureBrowserSession(sessionId);
    return c.json({ ok: true, entries: browserNetworkLog(sessionId) });
  } catch (err) {
    const { status, body } = browserErrorResponse(err);
    return c.json(body, status);
  }
});

/** UI 点击 / 输入代理 */
browserRoutes.post("/:sessionId/input", async (c) => {
  const sessionId = c.req.param("sessionId");
  try {
    const body = parseBrowserInput(await c.req.json());
    if (body.type === "click") {
      await dispatchBrowserAction(sessionId, legacyClickAction(body.x, body.y));
    } else {
      await dispatchBrowserAction(sessionId, { type: "type", text: body.text });
    }
    const frame = await getBrowserFrame(sessionId);
    return c.json({ ok: true, frame });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("INVALID_")) {
      return c.json({ ok: false, error: "invalid_body" }, 400);
    }
    const { status, body: errBody } = browserErrorResponse(err);
    return c.json(errBody, status);
  }
});
