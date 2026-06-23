import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import {
  BROWSER_DEFAULT_VIEWPORT,
  browserWsPath,
  type BrowserClientAction,
  type BrowserModifierKey,
  type BrowserMouseButton,
  type BrowserServerMessage,
  type BrowserViewport,
} from "@openx/shared";
import { getWsBase } from "./api-base";
import { fitBrowserFrame, mapScreencastClick } from "./browser-screencast-click";

type Options = {
  sessionId: string;
  startUrl?: string;
  enabled?: boolean;
};

function wsUrl(sessionId: string, startUrl?: string): string {
  const qs = startUrl ? `?startUrl=${encodeURIComponent(startUrl)}` : "";
  const path = `${browserWsPath(sessionId)}${qs}`;
  return `${getWsBase()}${path}`;
}

function modifiersFromEvent(e: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): BrowserModifierKey[] {
  const mods: BrowserModifierKey[] = [];
  if (e.altKey) mods.push("Alt");
  if (e.ctrlKey) mods.push("Control");
  if (e.metaKey) mods.push("Meta");
  if (e.shiftKey) mods.push("Shift");
  return mods;
}

function mouseButtonName(button: number): BrowserMouseButton {
  if (button === 2) return "right";
  if (button === 1) return "middle";
  return "left";
}

function mouseButtonsFromBits(bits: number): BrowserMouseButton[] {
  const buttons: BrowserMouseButton[] = [];
  if (bits & 1) buttons.push("left");
  if (bits & 2) buttons.push("right");
  if (bits & 4) buttons.push("middle");
  return buttons;
}

/** 仅在 OPEN 时发送；永不抛错（避免 CONNECTING 时 Uncaught） */
function safeWsSend(ws: WebSocket, data: string): boolean {
  if (ws.readyState !== WebSocket.OPEN) return false;
  try {
    ws.send(data);
    return true;
  } catch {
    return false;
  }
}

function queueOrSend(ws: WebSocket, pending: string[], data: string): void {
  if (safeWsSend(ws, data)) return;
  if (ws.readyState === WebSocket.CONNECTING) pending.push(data);
}

/** JPEG Blob → Canvas（ImageBitmap） */
function drawJpegBlobToCanvas(
  canvas: HTMLCanvasElement,
  blob: Blob,
  width: number,
  height: number,
): Promise<void> {
  return createImageBitmap(blob).then((bitmap) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return;
    }
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
  });
}

function jpegBase64ToBlob(data: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "image/jpeg" });
}

export function useBrowserBridge({ sessionId, startUrl, enabled = true }: Options) {
  const [viewport, setViewport] = useState<BrowserViewport>(BROWSER_DEFAULT_VIEWPORT);
  const [frameReady, setFrameReady] = useState(false);
  const [pageUrl, setPageUrl] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const [mock, setMock] = useState(false);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [findResult, setFindResult] = useState<{ current: number; total: number; found: boolean } | null>(
    null,
  );
  const [reconnectTick, setReconnectTick] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const pendingSendRef = useRef<string[]>([]);
  const connGenRef = useRef(0);
  const frameRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const drawGenRef = useRef(0);
  const lastMoveSentRef = useRef(0);
  const lastScrollSentRef = useRef(0);
  const lastViewportSentRef = useRef({ w: 0, h: 0 });
  const pendingBinaryMetaRef = useRef<{ width: number; height: number } | null>(null);
  const draggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number; clientX: number; clientY: number } | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;

  const DRAG_CLICK_PX = 5;
  const MOVE_THROTTLE_MS = 32;
  const SCROLL_THROTTLE_MS = 50;
  const VIEWPORT_DEBOUNCE_MS = 500;
  const VIEWPORT_MIN_DELTA_PX = 32;

  const sendRaw = useCallback((payload: string) => {
    const ws = wsRef.current;
    if (!ws) return;
    queueOrSend(ws, pendingSendRef.current, payload);
  }, []);

  const sendAction = useCallback(
    (action: BrowserClientAction) => {
      sendRaw(JSON.stringify({ type: "action", action }));
    },
    [sendRaw],
  );

  const pointToViewport = useCallback((clientX: number, clientY: number) => {
    const el = frameRef.current;
    if (!el) return null;
    const vp = viewportRef.current;
    return mapScreencastClick(el, clientX, clientY, vp.width, vp.height);
  }, []);

  const fitFrame = useCallback(() => {
    const stage = stageRef.current;
    const el = frameRef.current;
    if (!stage || !el) return;
    const vp = viewportRef.current;
    fitBrowserFrame(stage, el, vp.width, vp.height);
  }, []);

  const paintBlob = useCallback(
    (blob: Blob, width: number, height: number) => {
      const canvas = frameRef.current;
      if (!canvas) return;
      const gen = ++drawGenRef.current;
      void drawJpegBlobToCanvas(canvas, blob, width, height).then(() => {
        if (gen !== drawGenRef.current) return;
        setFrameReady(true);
        requestAnimationFrame(fitFrame);
      });
    },
    [fitFrame],
  );

  const paintFrame = useCallback(
    (data: string, width: number, height: number) => {
      paintBlob(jpegBase64ToBlob(data), width, height);
    },
    [paintBlob],
  );

  useEffect(() => {
    if (!enabled || !sessionId) return;

    const myGen = connGenRef.current + 1;
    connGenRef.current = myGen;
    let unmounted = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    setLoading(true);
    setError(null);
    pendingSendRef.current = [];

    const flushPending = () => {
      if (!ws) return;
      const batch = pendingSendRef.current.splice(0);
      for (const msg of batch) safeWsSend(ws, msg);
    };

    const scheduleReconnect = () => {
      if (unmounted || connGenRef.current !== myGen) return;
      reconnectTimer = setTimeout(() => {
        if (!unmounted && connGenRef.current === myGen) {
          setReconnectTick((n) => n + 1);
        }
      }, 1200);
    };

    const connectTimer = setTimeout(() => {
      if (unmounted || connGenRef.current !== myGen) return;

      ws = new WebSocket(wsUrl(sessionId, startUrl));
      ws.binaryType = "blob";
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmounted || connGenRef.current !== myGen) return;
        setConnected(true);
        setError(null);
        safeWsSend(ws!, JSON.stringify({ type: "hello", client: "openx-web", role: "human" }));
        flushPending();
      };
      ws.onclose = (ev) => {
        if (unmounted || connGenRef.current !== myGen) return;
        setConnected(false);
        setLoading(false);
        if (!ev.wasClean) scheduleReconnect();
      };
      ws.onerror = () => {
        if (unmounted || connGenRef.current !== myGen) return;
        setError("WebSocket 连接失败");
      };
      ws.onmessage = (ev) => {
        if (unmounted || connGenRef.current !== myGen) return;

        if (ev.data instanceof Blob) {
          const meta = pendingBinaryMetaRef.current;
          if (!meta) return;
          pendingBinaryMetaRef.current = null;
          paintBlob(ev.data, meta.width, meta.height);
          setLoading(false);
          setError(null);
          return;
        }

        let msg: BrowserServerMessage;
        try {
          msg = JSON.parse(String(ev.data)) as BrowserServerMessage;
        } catch {
          return;
        }

        switch (msg.type) {
          case "ready":
            setViewport(msg.viewport);
            setPageUrl(msg.url);
            setPageTitle(msg.title);
            setMock(msg.mock);
            setLoading(false);
            setError(null);
            requestAnimationFrame(fitFrame);
            break;
          case "screenshot": {
            setViewport({
              width: msg.width,
              height: msg.height,
              deviceScaleFactor: msg.deviceScaleFactor,
            });
            setPageUrl(msg.url);
            setMock(msg.mock);
            if (msg.encoding === "binary") {
              pendingBinaryMetaRef.current = { width: msg.width, height: msg.height };
            } else if (msg.data) {
              paintFrame(msg.data, msg.width, msg.height);
            }
            setLoading(false);
            setError(null);
            break;
          }
          case "page":
            setPageUrl(msg.url);
            setPageTitle(msg.title);
            break;
          case "findResult":
            setFindResult({ current: msg.current, total: msg.total, found: msg.found });
            break;
          case "error":
            setError(msg.message);
            setLoading(false);
            break;
          default:
            break;
        }
      };
    }, 0);

    return () => {
      unmounted = true;
      connGenRef.current += 1;
      clearTimeout(connectTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      pendingSendRef.current = [];
      if (ws) {
        ws.onopen = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        // CONNECTING 时不 close，避免 Strict Mode 控制台警告
        if (ws.readyState === WebSocket.OPEN) ws.close(1000, "unmount");
      }
      if (wsRef.current === ws) wsRef.current = null;
    };
  }, [enabled, fitFrame, paintBlob, paintFrame, reconnectTick, sessionId, startUrl]);

  useEffect(() => {
    const onResize = () => fitFrame();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fitFrame]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !connected) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pushViewport = () => {
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      if (w < 80 || h < 60) return;
      const last = lastViewportSentRef.current;
      if (Math.abs(w - last.w) < VIEWPORT_MIN_DELTA_PX && Math.abs(h - last.h) < VIEWPORT_MIN_DELTA_PX) {
        requestAnimationFrame(fitFrame);
        return;
      }
      lastViewportSentRef.current = { w, h };
      sendRaw(
        JSON.stringify({
          type: "action",
          action: { type: "setViewport", width: w, height: h },
        }),
      );
      requestAnimationFrame(fitFrame);
    };
    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(pushViewport, VIEWPORT_DEBOUNCE_MS);
    });
    ro.observe(stage);
    pushViewport();
    return () => {
      ro.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [connected, fitFrame, sendRaw, sessionId]);

  const onFrameMouseDown = useCallback(
    (e: MouseEvent<HTMLCanvasElement>) => {
      if (mock || !connected) return;
      e.preventDefault();
      e.stopPropagation();
      stageRef.current?.focus();
      const pt = pointToViewport(e.clientX, e.clientY);
      if (!pt) return;
      lastPointerRef.current = pt;
      dragStartRef.current = { x: pt.x, y: pt.y, clientX: e.clientX, clientY: e.clientY };
      sendAction({
        type: "mousedown",
        x: pt.x,
        y: pt.y,
        button: mouseButtonName(e.button),
        clickCount: e.detail || 1,
        modifiers: modifiersFromEvent(e),
      });
      draggingRef.current = true;
    },
    [connected, mock, pointToViewport, sendAction],
  );

  const onFrameMouseUp = useCallback(
    (e: globalThis.MouseEvent) => {
      if (!draggingRef.current || mock || !connected) return;
      draggingRef.current = false;
      const pt = pointToViewport(e.clientX, e.clientY) ?? lastPointerRef.current;
      if (!pt) return;
      const start = dragStartRef.current;
      dragStartRef.current = null;
      const movedPx = start
        ? Math.hypot(e.clientX - start.clientX, e.clientY - start.clientY)
        : DRAG_CLICK_PX + 1;
      if (e.button === 0 && movedPx < DRAG_CLICK_PX && start) {
        sendAction({
          type: "click",
          x: start.x,
          y: start.y,
          button: "left",
          clickCount: e.detail || 1,
          modifiers: modifiersFromEvent(e),
        });
        return;
      }
      sendAction({
        type: "mouseup",
        x: pt.x,
        y: pt.y,
        button: mouseButtonName(e.button),
        clickCount: e.detail || 1,
        modifiers: modifiersFromEvent(e),
      });
    },
    [connected, mock, pointToViewport, sendAction],
  );

  useEffect(() => {
    window.addEventListener("mouseup", onFrameMouseUp);
    return () => window.removeEventListener("mouseup", onFrameMouseUp);
  }, [onFrameMouseUp]);

  const onFrameMouseMove = useCallback(
    (e: globalThis.MouseEvent) => {
      if (mock || !connected || !draggingRef.current) return;
      const now = Date.now();
      if (now - lastMoveSentRef.current < MOVE_THROTTLE_MS) return;
      lastMoveSentRef.current = now;
      const pt = pointToViewport(e.clientX, e.clientY);
      if (!pt) return;
      lastPointerRef.current = pt;
      sendAction({
        type: "mousemove",
        x: pt.x,
        y: pt.y,
        buttons: mouseButtonsFromBits(e.buttons),
        modifiers: modifiersFromEvent(e),
      });
    },
    [connected, mock, pointToViewport, sendAction],
  );

  useEffect(() => {
    window.addEventListener("mousemove", onFrameMouseMove);
    return () => window.removeEventListener("mousemove", onFrameMouseMove);
  }, [onFrameMouseMove]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: globalThis.WheelEvent) => {
      if (mock || !connected) return;
      e.preventDefault();
      e.stopPropagation();
      const now = Date.now();
      if (now - lastScrollSentRef.current < SCROLL_THROTTLE_MS) return;
      lastScrollSentRef.current = now;
      const pt = pointToViewport(e.clientX, e.clientY);
      if (!pt) return;
      sendAction({
        type: "scroll",
        x: pt.x,
        y: pt.y,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
      });
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [connected, mock, pointToViewport, sendAction]);

  const onFrameKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (mock || !connected) return;
      if (e.key === "Tab") return;

      const mods = modifiersFromEvent(e);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        e.preventDefault();
        void navigator.clipboard.readText().then((text) => {
          if (text) sendAction({ type: "paste", text });
        });
        return;
      }

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        sendAction({ type: "type", text: e.key });
        return;
      }

      e.preventDefault();
      sendAction({
        type: "key",
        key: e.key,
        code: e.code,
        phase: "press",
        modifiers: mods,
      });
    },
    [connected, mock, sendAction],
  );

  const navigate = useCallback(
    (url: string) => {
      sendAction({ type: "navigate", url });
    },
    [sendAction],
  );

  const goBack = useCallback(() => sendAction({ type: "back" }), [sendAction]);
  const goForward = useCallback(() => sendAction({ type: "forward" }), [sendAction]);
  const reload = useCallback(() => sendAction({ type: "reload" }), [sendAction]);
  const paste = useCallback((text: string) => sendAction({ type: "paste", text }), [sendAction]);
  const find = useCallback(
    (query: string, direction: "next" | "prev" = "next", fromStart = false) => {
      setFindResult(null);
      sendAction({ type: "find", query, direction, fromStart });
    },
    [sendAction],
  );
  const findStop = useCallback(() => {
    sendAction({ type: "findStop" });
    setFindResult(null);
  }, [sendAction]);

  return {
    viewport,
    frameReady,
    pageUrl,
    pageTitle,
    mock,
    connected,
    loading,
    error,
    frameRef,
    stageRef,
    fitFrame,
    navigate,
    goBack,
    goForward,
    reload,
    paste,
    find,
    findStop,
    findResult,
    sendAction,
    onFrameMouseDown,
    onFrameKeyDown,
  };
}
