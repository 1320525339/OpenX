import { existsSync } from "node:fs";
import puppeteer, { type Browser, type CDPSession, type KeyInput, type Page } from "puppeteer-core";
import type {
  BrowserClientAction,
  BrowserScreenshotMessage,
  BrowserViewport,
} from "@openx/shared";
import {
  captureBrowserDom,
  createNetworkLog,
  runBrowserFind,
  runBrowserFindStop,
  type BrowserDomSnapshot,
  type BrowserNetworkEntry,
} from "./browser-observe.js";
import {
  clampViewportPoint,
  cdpButtonsMask,
  cdpMouseButton,
  legacyClickAction,
  modifiersToCdpBits,
  toScreenshotMessage,
} from "./browser-cdp-input.js";

export type { BrowserDomSnapshot, BrowserNetworkEntry };

export type BrowserDispatchResult = {
  find?: { current: number; total: number; found: boolean };
};

const VIEWPORT: BrowserViewport = { width: 1280, height: 720, deviceScaleFactor: 1 };

function isBrowserGameMode(): boolean {
  return process.env.OPENX_BROWSER_GAME_MODE === "1";
}

function screencastMinFrameMs(): number {
  const raw = process.env.OPENX_BROWSER_MAX_FPS;
  if (raw) {
    const fps = Number(raw);
    if (Number.isFinite(fps) && fps > 0) return Math.max(16, Math.round(1000 / fps));
  }
  const custom = process.env.OPENX_BROWSER_MIN_FRAME_MS;
  if (custom) {
    const ms = Number(custom);
    if (Number.isFinite(ms) && ms > 0) return ms;
  }
  return isBrowserGameMode() ? 50 : 33;
}

function screencastOptions(vp: BrowserViewport) {
  const game = isBrowserGameMode();
  const qualityRaw = process.env.OPENX_BROWSER_JPEG_QUALITY;
  const quality = qualityRaw
    ? Math.max(1, Math.min(100, Number(qualityRaw) || 60))
    : game
      ? 45
      : 60;
  const nthRaw = process.env.OPENX_BROWSER_EVERY_NTH_FRAME;
  const everyNthFrame = nthRaw
    ? Math.max(1, Math.round(Number(nthRaw) || 1))
    : game
      ? 2
      : 1;
  return {
    format: "jpeg" as const,
    quality,
    maxWidth: vp.width,
    maxHeight: vp.height,
    everyNthFrame,
  };
}

/** 1×1 灰色 JPEG，mock 模式占位 */
const MOCK_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDAREAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJ+AB//Z";

export type BrowserFrame = {
  sessionId: string;
  imageBase64: string;
  mime: "image/jpeg";
  width: number;
  height: number;
  url: string;
  mock: boolean;
  updatedAt: number;
};

type SessionRecord = {
  sessionId: string;
  browser: Browser | null;
  page: Page | null;
  cdp: CDPSession | null;
  mock: boolean;
  startUrl: string;
  currentUrl: string;
  title: string;
  viewport: BrowserViewport;
  lastFrame: string | null;
  lastFrameAt: number;
  lastEmitAt: number;
  frameSeq: number;
  starting: Promise<void> | null;
  networkLog: ReturnType<typeof createNetworkLog>;
};

function sessionViewport(record: SessionRecord): BrowserViewport {
  return record.viewport;
}

const sessions = new Map<string, SessionRecord>();
const frameSubscribers = new Map<string, Set<(msg: BrowserScreenshotMessage, jpeg?: Buffer) => void>>();

function useBinaryFrameEncoding(): boolean {
  return process.env.OPENX_BROWSER_FRAME_ENCODING !== "base64";
}

export function isBrowserMockMode(): boolean {
  return process.env.OPENX_BROWSER_MOCK === "1";
}

function resolveBrowserExecutable(): string | undefined {
  const explicit = process.env.OPENX_CHROME_PATH?.trim() || process.env.OPENX_BROWSER_PATH?.trim();
  if (explicit && existsSync(explicit)) return explicit;
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
  ];
  return candidates.find((p) => existsSync(p));
}

function shouldFallbackToMock(err: unknown): boolean {
  if (isBrowserMockMode()) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return msg === "CHROME_NOT_FOUND" || msg === "BROWSER_LAUNCH_FAILED";
}

function adoptMockSession(sessionId: string, startUrl: string): SessionRecord {
  const mock = mockRecord(sessionId, startUrl);
  sessions.set(sessionId, mock);
  return mock;
}

function mockRecord(sessionId: string, startUrl: string): SessionRecord {
  const url = startUrl.trim() || "about:blank";
  return {
    sessionId,
    browser: null,
    page: null,
    cdp: null,
    mock: true,
    startUrl: url,
    currentUrl: url,
    title: "",
    lastFrame: MOCK_JPEG_BASE64,
    lastFrameAt: Date.now(),
    lastEmitAt: 0,
    frameSeq: 0,
    starting: null,
    viewport: { ...VIEWPORT },
    networkLog: createNetworkLog(),
  };
}

export function getBrowserViewport(sessionId?: string): BrowserViewport {
  if (sessionId) {
    const record = sessions.get(sessionId);
    if (record) return { ...record.viewport };
  }
  return { ...VIEWPORT };
}

export function subscribeBrowserFrames(
  sessionId: string,
  cb: (msg: BrowserScreenshotMessage, jpeg?: Buffer) => void,
): () => void {
  let set = frameSubscribers.get(sessionId);
  if (!set) {
    set = new Set();
    frameSubscribers.set(sessionId, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (set!.size === 0) frameSubscribers.delete(sessionId);
  };
}

function buildScreenshotMessage(record: SessionRecord): BrowserScreenshotMessage | null {
  if (!record.lastFrame) return null;
  return toScreenshotMessage({
    data: record.lastFrame,
    width: record.viewport.width,
    height: record.viewport.height,
    deviceScaleFactor: record.viewport.deviceScaleFactor,
    frame: record.frameSeq,
    url: record.currentUrl,
    mock: record.mock,
  });
}

export function pushBrowserScreenshot(sessionId: string): void {
  const record = sessions.get(sessionId);
  if (!record?.lastFrame) return;
  notifyFrameSubscribers(record, true);
}

function notifyFrameSubscribers(record: SessionRecord, force = false): void {
  if (!record.lastFrame) return;
  const now = Date.now();
  if (!force && now - record.lastEmitAt < screencastMinFrameMs()) return;
  record.lastEmitAt = now;
  record.frameSeq += 1;
  const msg = buildScreenshotMessage(record);
  if (!msg) return;
  const sendBinary = useBinaryFrameEncoding() && !record.mock && record.lastFrame;
  if (sendBinary) {
    const jpeg = Buffer.from(record.lastFrame!, "base64");
    const { data: _drop, ...meta } = msg;
    frameSubscribers.get(record.sessionId)?.forEach((cb) => cb({ ...meta, encoding: "binary" }, jpeg));
    return;
  }
  frameSubscribers.get(record.sessionId)?.forEach((cb) => cb({ ...msg, encoding: "base64" }));
}

async function syncPageMeta(record: SessionRecord): Promise<void> {
  if (record.mock || !record.page) return;
  try {
    record.currentUrl = record.page.url();
    record.title = await record.page.title();
  } catch {
    /* page may be navigating */
  }
}

export async function getSessionPageMeta(
  sessionId: string,
): Promise<{ url: string; title: string }> {
  const record = sessions.get(sessionId);
  if (!record) return { url: "about:blank", title: "" };
  await syncPageMeta(record);
  return { url: record.currentUrl, title: record.title };
}

async function attachScreencast(record: SessionRecord): Promise<void> {
  if (!record.page || record.mock) return;
  const cdp = await record.page.createCDPSession();
  record.cdp = cdp;
  const vp = sessionViewport(record);
  cdp.on("Page.screencastFrame", async (frame: { data: string; sessionId: number }) => {
    record.lastFrame = frame.data;
    record.lastFrameAt = Date.now();
    notifyFrameSubscribers(record);
    try {
      await cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId });
    } catch {
      /* page may be closing */
    }
  });
  await cdp.send("Page.startScreencast", screencastOptions(vp));

  try {
    await cdp.send("Network.enable");
    const pending = new Map<string, { url: string; method: string; ts: number }>();
    cdp.on("Network.requestWillBeSent", (evt: { requestId: string; request: { url: string; method: string } }) => {
      pending.set(evt.requestId, {
        url: evt.request.url,
        method: evt.request.method,
        ts: Date.now(),
      });
    });
    cdp.on(
      "Network.responseReceived",
      (evt: {
        requestId: string;
        response: { url: string; status: number; mimeType: string };
      }) => {
        const req = pending.get(evt.requestId);
        record.networkLog.push({
          id: evt.requestId,
          url: req?.url ?? evt.response.url,
          method: req?.method ?? "GET",
          status: evt.response.status,
          mimeType: evt.response.mimeType,
          ts: req?.ts ?? Date.now(),
        });
        pending.delete(evt.requestId);
      },
    );
  } catch {
    /* Network domain optional */
  }
}

async function launchRealSession(record: SessionRecord): Promise<void> {
  const executablePath = resolveBrowserExecutable();
  if (!executablePath) {
    throw new Error("CHROME_NOT_FOUND");
  }
  let browser: Browser | null = null;
  try {
    browser = await puppeteer.launch({
      executablePath,
      headless: process.env.OPENX_BROWSER_HEADLESS !== "0",
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      defaultViewport: sessionViewport(record),
    });
    const page = await browser.newPage();
    record.browser = browser;
    record.page = page;
    record.mock = false;
    const url = record.startUrl.trim() || "about:blank";
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    record.currentUrl = page.url();
    record.title = await page.title();
    await attachScreencast(record);
    try {
      const shot = await page.screenshot({ type: "jpeg", quality: 72 });
      record.lastFrame = Buffer.from(shot).toString("base64");
      record.lastFrameAt = Date.now();
    } catch {
      /* ignore first-shot errors */
    }
  } catch (err) {
    try {
      if (browser) await browser.close();
    } catch {
      /* ignore */
    }
    record.browser = null;
    record.page = null;
    record.cdp = null;
    if (err instanceof Error && err.message === "CHROME_NOT_FOUND") throw err;
    throw new Error("BROWSER_LAUNCH_FAILED", { cause: err });
  }
}

async function ensureSessionInternal(sessionId: string, startUrl?: string): Promise<SessionRecord> {
  let record = sessions.get(sessionId);
  if (record) {
    if (startUrl?.trim() && record.startUrl !== startUrl.trim()) {
      record.startUrl = startUrl.trim();
      if (record.mock) record.currentUrl = startUrl.trim();
      else if (record.page) await navigateSessionInternal(record, startUrl.trim());
    }
    if (record.starting) {
      try {
        await record.starting;
      } catch {
        sessions.delete(sessionId);
        record = undefined;
      }
    }
    if (record && (record.mock || record.page)) return record;
    if (record && !record.page && !record.mock) {
      sessions.delete(sessionId);
    }
  }

  const url = startUrl?.trim() || record?.startUrl?.trim() || "about:blank";
  if (isBrowserMockMode()) {
    record = mockRecord(sessionId, url);
    sessions.set(sessionId, record);
    return record;
  }

  record = {
    sessionId,
    browser: null,
    page: null,
    cdp: null,
    mock: false,
    startUrl: url,
    currentUrl: url,
    title: "",
    viewport: { ...VIEWPORT },
    lastFrame: null,
    lastFrameAt: 0,
    lastEmitAt: 0,
    frameSeq: 0,
    starting: null,
    networkLog: createNetworkLog(),
  };
  sessions.set(sessionId, record);
  record.starting = launchRealSession(record).finally(() => {
    if (sessions.get(sessionId) === record) record!.starting = null;
  });
  try {
    await record.starting;
    return record;
  } catch (err) {
    sessions.delete(sessionId);
    if (shouldFallbackToMock(err)) {
      return adoptMockSession(sessionId, url);
    }
    throw err;
  }
}

async function navigateSessionInternal(record: SessionRecord, url: string): Promise<void> {
  if (record.mock) {
    record.currentUrl = url;
    record.lastFrameAt = Date.now();
    return;
  }
  if (!record.page) throw new Error("BROWSER_SESSION_NOT_READY");
  await record.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  record.currentUrl = record.page.url();
}

export async function ensureBrowserSession(
  sessionId: string,
  startUrl?: string,
): Promise<{ sessionId: string; url: string; mock: boolean }> {
  const record = await ensureSessionInternal(sessionId, startUrl);
  return { sessionId, url: record.currentUrl, mock: record.mock };
}

export async function navigateBrowserSession(sessionId: string, url: string): Promise<string> {
  const record = await ensureSessionInternal(sessionId, url);
  await navigateSessionInternal(record, url);
  return record.currentUrl;
}

async function applySessionViewport(record: SessionRecord, width: number, height: number): Promise<void> {
  const w = Math.max(320, Math.min(2560, Math.round(width)));
  const h = Math.max(200, Math.min(1600, Math.round(height)));
  if (record.viewport.width === w && record.viewport.height === h) return;
  record.viewport = { width: w, height: h, deviceScaleFactor: 1 };
  if (record.mock || !record.page) return;
  await record.page.setViewport({ width: w, height: h });
  if (!record.cdp) return;
  try {
    await record.cdp.send("Page.stopScreencast");
    await record.cdp.send("Page.startScreencast", screencastOptions(record.viewport));
  } catch {
    /* page may be navigating */
  }
}

async function dispatchMouseEvent(
  record: SessionRecord,
  params: {
    type: "mouseMoved" | "mousePressed" | "mouseReleased" | "mouseWheel";
    x: number;
    y: number;
    button?: "left" | "middle" | "right";
    clickCount?: number;
    modifiers?: number;
    buttons?: number;
    deltaX?: number;
    deltaY?: number;
  },
): Promise<void> {
  if (!record.page) throw new Error("BROWSER_SESSION_NOT_READY");
  const vp = sessionViewport(record);
  const { x, y } = clampViewportPoint(params.x, params.y, vp.width, vp.height);
  if (record.cdp) {
    await record.cdp.send("Input.dispatchMouseEvent", {
      type: params.type,
      x,
      y,
      button: params.button,
      clickCount: params.clickCount,
      modifiers: params.modifiers ?? 0,
      buttons: params.buttons,
      deltaX: params.deltaX,
      deltaY: params.deltaY,
    });
  } else if (params.type === "mouseWheel") {
    await record.page.mouse.wheel({ deltaX: params.deltaX ?? 0, deltaY: params.deltaY ?? 0 });
  } else if (params.type === "mousePressed") {
    await record.page.mouse.move(x, y);
    await record.page.mouse.down({ button: params.button ?? "left" });
  } else if (params.type === "mouseReleased") {
    await record.page.mouse.move(x, y);
    await record.page.mouse.up({ button: params.button ?? "left" });
  } else {
    await record.page.mouse.move(x, y);
  }
}

async function dispatchKeyEvent(
  record: SessionRecord,
  key: string,
  phase: "down" | "up" | "press",
  modifiers?: number,
): Promise<void> {
  if (!record.page) throw new Error("BROWSER_SESSION_NOT_READY");
  if (phase === "press") {
    await record.page.keyboard.press(key as KeyInput);
    return;
  }
  if (record.cdp) {
    await record.cdp.send("Input.dispatchKeyEvent", {
      type: phase === "down" ? "keyDown" : "keyUp",
      key,
      modifiers: modifiers ?? 0,
    });
  } else if (phase === "down") {
    await record.page.keyboard.down(key as KeyInput);
  } else {
    await record.page.keyboard.up(key as KeyInput);
  }
}

export async function dispatchBrowserAction(
  sessionId: string,
  action: BrowserClientAction,
): Promise<BrowserDispatchResult | void> {
  const record = await ensureSessionInternal(sessionId);
  if (record.mock) {
    record.lastFrameAt = Date.now();
    pushBrowserScreenshot(sessionId);
    if (action.type === "find") {
      return { find: { current: 0, total: 0, found: false } };
    }
    return;
  }

  switch (action.type) {
    case "navigate":
      await navigateSessionInternal(record, action.url);
      await syncPageMeta(record);
      break;
    case "reload":
      if (!record.page) throw new Error("BROWSER_SESSION_NOT_READY");
      await record.page.reload({ waitUntil: "domcontentloaded" });
      await syncPageMeta(record);
      break;
    case "back":
      if (!record.page) throw new Error("BROWSER_SESSION_NOT_READY");
      await record.page.goBack({ waitUntil: "domcontentloaded" });
      await syncPageMeta(record);
      break;
    case "forward":
      if (!record.page) throw new Error("BROWSER_SESSION_NOT_READY");
      await record.page.goForward({ waitUntil: "domcontentloaded" });
      await syncPageMeta(record);
      break;
    case "click": {
      const mods = modifiersToCdpBits(action.modifiers);
      const btn = cdpMouseButton(action.button);
      await dispatchMouseEvent(record, {
        type: "mouseMoved",
        x: action.x,
        y: action.y,
        modifiers: mods,
      });
      await dispatchMouseEvent(record, {
        type: "mousePressed",
        x: action.x,
        y: action.y,
        button: btn,
        clickCount: action.clickCount ?? 1,
        modifiers: mods,
      });
      await dispatchMouseEvent(record, {
        type: "mouseReleased",
        x: action.x,
        y: action.y,
        button: btn,
        clickCount: action.clickCount ?? 1,
        modifiers: mods,
      });
      await syncPageMeta(record);
      await refreshFrameAfterInteraction(record);
      break;
    }
    case "mousedown":
      await dispatchMouseEvent(record, {
        type: "mouseMoved",
        x: action.x,
        y: action.y,
        modifiers: modifiersToCdpBits(action.modifiers),
      });
      await dispatchMouseEvent(record, {
        type: "mousePressed",
        x: action.x,
        y: action.y,
        button: cdpMouseButton(action.button),
        clickCount: action.clickCount ?? 1,
        modifiers: modifiersToCdpBits(action.modifiers),
      });
      break;
    case "mouseup":
      await dispatchMouseEvent(record, {
        type: "mouseMoved",
        x: action.x,
        y: action.y,
        modifiers: modifiersToCdpBits(action.modifiers),
      });
      await dispatchMouseEvent(record, {
        type: "mouseReleased",
        x: action.x,
        y: action.y,
        button: cdpMouseButton(action.button),
        clickCount: action.clickCount ?? 1,
        modifiers: modifiersToCdpBits(action.modifiers),
      });
      await syncPageMeta(record);
      await refreshFrameAfterInteraction(record);
      break;
    case "mousemove":
      await dispatchMouseEvent(record, {
        type: "mouseMoved",
        x: action.x,
        y: action.y,
        modifiers: modifiersToCdpBits(action.modifiers),
        buttons: cdpButtonsMask(action.buttons),
      });
      break;
    case "scroll":
      await dispatchMouseEvent(record, {
        type: "mouseMoved",
        x: action.x,
        y: action.y,
      });
      await dispatchMouseEvent(record, {
        type: "mouseWheel",
        x: action.x,
        y: action.y,
        deltaX: action.deltaX,
        deltaY: action.deltaY,
      });
      await refreshFrameAfterInteraction(record);
      break;
    case "key":
      await dispatchKeyEvent(record, action.key, action.phase, modifiersToCdpBits(action.modifiers));
      await refreshFrameAfterInteraction(record);
      break;
    case "paste":
    case "type":
      if (!record.page) throw new Error("BROWSER_SESSION_NOT_READY");
      if (record.cdp) {
        await record.cdp.send("Input.insertText", { text: action.text });
      } else {
        await record.page.keyboard.type(action.text);
      }
      await refreshFrameAfterInteraction(record);
      break;
    case "find": {
      if (!record.page) throw new Error("BROWSER_SESSION_NOT_READY");
      const find = await runBrowserFind(
        record.page,
        action.query,
        action.direction ?? "next",
        action.fromStart ?? false,
      );
      await refreshFrameAfterInteraction(record);
      return { find };
    }
    case "findStop":
      if (record.page) await runBrowserFindStop(record.page);
      break;
    case "setViewport":
      await applySessionViewport(record, action.width, action.height);
      break;
    default:
      break;
  }
}

async function refreshFrameAfterInteraction(record: SessionRecord): Promise<void> {
  if (!record.page || record.mock) {
    record.lastFrameAt = Date.now();
    pushBrowserScreenshot(record.sessionId);
    return;
  }
  // CDP screencast 已在推帧 — 跳过 80ms + 全页 screenshot（browserface / atrium 模式）
  if (record.cdp) {
    await syncPageMeta(record);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 80));
  try {
    const shot = await record.page.screenshot({ type: "jpeg", quality: 72 });
    record.lastFrame = Buffer.from(shot).toString("base64");
    record.lastFrameAt = Date.now();
    await syncPageMeta(record);
    pushBrowserScreenshot(record.sessionId);
  } catch {
    /* screencast may still deliver a later frame */
  }
}

export async function clickBrowserSession(sessionId: string, x: number, y: number): Promise<void> {
  await dispatchBrowserAction(sessionId, legacyClickAction(x, y));
}

export async function typeBrowserSession(sessionId: string, text: string): Promise<void> {
  const record = await ensureSessionInternal(sessionId);
  if (record.mock) return;
  if (!record.page) throw new Error("BROWSER_SESSION_NOT_READY");
  await record.page.keyboard.type(text);
}

export async function screenshotBrowserSession(
  sessionId: string,
): Promise<{ imageBase64: string; width: number; height: number; url: string }> {
  const record = await ensureSessionInternal(sessionId);
  if (record.mock) {
    return {
      imageBase64: record.lastFrame ?? MOCK_JPEG_BASE64,
      width: record.viewport.width,
      height: record.viewport.height,
      url: record.currentUrl,
    };
  }
  if (!record.page) throw new Error("BROWSER_SESSION_NOT_READY");
  const shot = await record.page.screenshot({ type: "jpeg", quality: 80 });
  const imageBase64 = Buffer.from(shot).toString("base64");
  record.lastFrame = imageBase64;
  record.lastFrameAt = Date.now();
  record.currentUrl = record.page.url();
  return {
    imageBase64,
    width: record.viewport.width,
    height: record.viewport.height,
    url: record.currentUrl,
  };
}

export async function getBrowserFrame(
  sessionId: string,
  startUrl?: string,
): Promise<BrowserFrame> {
  const record = await ensureSessionInternal(sessionId, startUrl);
  if (!record.lastFrame && !record.mock) {
    const shot = await screenshotBrowserSession(sessionId);
    return {
      sessionId,
      imageBase64: shot.imageBase64,
      mime: "image/jpeg",
      width: shot.width,
      height: shot.height,
      url: shot.url,
      mock: record.mock,
      updatedAt: Date.now(),
    };
  }
  return {
    sessionId,
    imageBase64: record.lastFrame ?? MOCK_JPEG_BASE64,
    mime: "image/jpeg",
    width: record.viewport.width,
    height: record.viewport.height,
    url: record.currentUrl,
    mock: record.mock,
    updatedAt: record.lastFrameAt || Date.now(),
  };
}

export async function closeBrowserSession(sessionId: string): Promise<void> {
  const record = sessions.get(sessionId);
  if (!record) return;
  sessions.delete(sessionId);
  frameSubscribers.delete(sessionId);
  try {
    if (record.cdp) await record.cdp.detach().catch(() => undefined);
  } catch {
    /* ignore */
  }
  try {
    if (record.browser) await record.browser.close();
  } catch {
    /* ignore */
  }
}

export async function closeAllBrowserSessions(): Promise<void> {
  const ids = [...sessions.keys()];
  await Promise.all(ids.map((id) => closeBrowserSession(id)));
}

export function browserSessionIds(): string[] {
  return [...sessions.keys()];
}

export async function browserDomSnapshot(sessionId: string): Promise<BrowserDomSnapshot> {
  const record = await ensureSessionInternal(sessionId);
  if (record.mock || !record.page) {
    return {
      url: record.currentUrl,
      title: record.title,
      text: record.mock ? "[mock browser — no DOM]" : "",
      links: [],
      inputs: [],
    };
  }
  return captureBrowserDom(record.page);
}

export function browserNetworkLog(sessionId: string): BrowserNetworkEntry[] {
  const record = sessions.get(sessionId);
  if (!record) return [];
  return record.networkLog.list();
}
