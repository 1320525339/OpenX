import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  clickBrowserSession,
  closeAllBrowserSessions,
  getBrowserFrame,
  navigateBrowserSession,
  screenshotBrowserSession,
} from "./browser-session.js";

describe("browser-session (mock)", () => {
  beforeEach(() => {
    process.env.OPENX_BROWSER_MOCK = "1";
  });

  afterEach(async () => {
    await closeAllBrowserSessions();
    delete process.env.OPENX_BROWSER_MOCK;
  });

  it("returns screencast frame in mock mode", async () => {
    const frame = await getBrowserFrame("sess-1", "https://example.com");
    expect(frame.sessionId).toBe("sess-1");
    expect(frame.imageBase64.length).toBeGreaterThan(10);
    expect(frame.mock).toBe(true);
    expect(frame.url).toBe("https://example.com");
  });

  it("navigates and screenshots in mock mode", async () => {
    await navigateBrowserSession("sess-2", "https://a.test");
    const shot = await screenshotBrowserSession("sess-2");
    expect(shot.url).toBe("https://a.test");
    await clickBrowserSession("sess-2", 100, 200);
    const frame = await getBrowserFrame("sess-2");
    expect(frame.updatedAt).toBeGreaterThan(0);
  });
});

describe("desktop-service browser commands", () => {
  const prevConfig = process.env.OPENX_CONFIG_PATH;
  const prevMock = process.env.OPENX_BROWSER_MOCK;

  beforeEach(() => {
    process.env.OPENX_BROWSER_MOCK = "1";
    const dir = mkdtempSync(join(tmpdir(), "openx-browser-cmd-"));
    process.env.OPENX_CONFIG_PATH = join(dir, "config.json");
  });

  afterEach(async () => {
    await closeAllBrowserSessions();
    if (prevConfig) process.env.OPENX_CONFIG_PATH = prevConfig;
    else delete process.env.OPENX_CONFIG_PATH;
    if (prevMock) process.env.OPENX_BROWSER_MOCK = prevMock;
    else delete process.env.OPENX_BROWSER_MOCK;
  });

  it("assigns sessionId and handles browser_click", async () => {
    const { createOxspSlot, runOxspSlotCommand } = await import("./desktop-service.js");
    const { slotId } = createOxspSlot("console", {
      kind: "browser",
      config: { kind: "browser", startUrl: "https://example.com" },
      pinCol: 0,
    });
    const { result } = await runOxspSlotCommand("console", slotId, {
      action: "browser_click",
      x: 10,
      y: 20,
    });
    expect(result).toEqual({ clicked: { x: 10, y: 20 } });
  });
});
