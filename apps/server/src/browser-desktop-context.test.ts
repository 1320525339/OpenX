import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeAllBrowserSessions } from "./browser-session.js";
import { buildBrowserDesktopContext, pinDesktopScopeForConversation } from "./browser-desktop-context.js";
import { createOxspSlot } from "./desktop-service.js";

describe("browser-desktop-context", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "openx-browser-ctx-"));
    process.env.OPENX_CONFIG_PATH = join(tempDir, "config.json");
    process.env.OPENX_BROWSER_MOCK = "1";
  });

  afterEach(async () => {
    await closeAllBrowserSessions();
    delete process.env.OPENX_CONFIG_PATH;
    delete process.env.OPENX_BROWSER_MOCK;
  });

  it("pinDesktopScopeForConversation maps system main to console", () => {
    expect(pinDesktopScopeForConversation("openx-system-main")).toBe("console");
    expect(pinDesktopScopeForConversation("conv-abc")).toBe("conversation");
  });

  it("buildBrowserDesktopContext includes dom for pinned browser slot", async () => {
    const { slotId } = createOxspSlot("console", {
      kind: "browser",
      config: { kind: "browser", startUrl: "https://example.com" },
      pinCol: 0,
    });
    const text = await buildBrowserDesktopContext("console");
    expect(text).toBeDefined();
    expect(text).toContain("浏览器拓展槽");
    expect(text).toContain(slotId);
    expect(text).toContain("example.com");
  });

  it("returns undefined when no pinned browser", async () => {
    createOxspSlot("console", {
      kind: "web",
      config: { kind: "web", url: "https://example.com" },
      pinCol: 1,
    });
    const text = await buildBrowserDesktopContext("console");
    expect(text).toBeUndefined();
  });
});
