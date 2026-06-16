/**
 * OpenX Browser Bridge 协议（browserface / browserd 子集）
 * JSON over WebSocket；REST /input 仍兼容旧 click/type。
 */

export type BrowserMouseButton = "left" | "middle" | "right";
export type BrowserModifierKey = "Alt" | "Control" | "Meta" | "Shift";

export type BrowserViewport = {
  width: number;
  height: number;
  deviceScaleFactor: number;
};

interface MousePoint {
  x: number;
  y: number;
  button?: BrowserMouseButton;
  clickCount?: number;
  modifiers?: BrowserModifierKey[];
}

export type BrowserClientAction =
  | ({ type: "click" } & MousePoint)
  | ({ type: "mousedown" } & MousePoint)
  | ({ type: "mouseup" } & MousePoint)
  | {
      type: "mousemove";
      x: number;
      y: number;
      buttons?: BrowserMouseButton[];
      modifiers?: BrowserModifierKey[];
    }
  | { type: "scroll"; x: number; y: number; deltaX: number; deltaY: number }
  | { type: "type"; text: string }
  | {
      type: "key";
      key: string;
      code?: string;
      phase: "down" | "up" | "press";
      modifiers?: BrowserModifierKey[];
    }
  | { type: "navigate"; url: string }
  | { type: "reload"; ignoreCache?: boolean }
  | { type: "back" }
  | { type: "forward" }
  | { type: "find"; query: string; direction?: "next" | "prev"; fromStart?: boolean }
  | { type: "findStop" }
  | { type: "paste"; text: string }
  | { type: "setViewport"; width: number; height: number };

export type BrowserClientMessage =
  | { type: "hello"; client: string; role: "human" | "agent" }
  | { type: "action"; id?: string; action: BrowserClientAction };

export type BrowserReadyMessage = {
  type: "ready";
  viewport: BrowserViewport;
  url: string;
  title: string;
  mock: boolean;
};

export type BrowserScreenshotMessage = {
  type: "screenshot";
  /** base64 内联 JSON；binary 时 JPEG 在紧随其后的 WS 二进制帧 */
  encoding?: "base64" | "binary";
  data?: string;
  format: "jpeg";
  width: number;
  height: number;
  deviceScaleFactor: number;
  frame: number;
  capturedAt: number;
  url: string;
  mock: boolean;
};

export type BrowserPageMessage = {
  type: "page";
  url: string;
  title: string;
  loading: boolean;
};

export type BrowserFindResultMessage = {
  type: "findResult";
  current: number;
  total: number;
  found: boolean;
};

export type BrowserServerMessage =
  | BrowserReadyMessage
  | BrowserScreenshotMessage
  | BrowserPageMessage
  | BrowserFindResultMessage
  | { type: "ack"; id?: string }
  | { type: "error"; id?: string; message: string };

export function browserStreamPath(sessionId: string): string {
  return `/api/desktop/browser/${encodeURIComponent(sessionId)}/stream`;
}

export const BROWSER_DEFAULT_VIEWPORT: BrowserViewport = {
  width: 1280,
  height: 720,
  deviceScaleFactor: 1,
};

export function browserWsPath(sessionId: string): string {
  return `/api/desktop/browser/${encodeURIComponent(sessionId)}/ws`;
}
