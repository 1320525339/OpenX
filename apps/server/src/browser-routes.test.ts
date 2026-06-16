import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeAllBrowserSessions } from "./browser-session.js";
import { app } from "./routes.js";

describe("browser routes (mock)", () => {
  beforeEach(() => {
    process.env.OPENX_BROWSER_MOCK = "1";
  });

  afterEach(async () => {
    await closeAllBrowserSessions();
    delete process.env.OPENX_BROWSER_MOCK;
  });

  it("GET frame returns jpeg screencast", async () => {
    const res = await app.request(
      "/api/desktop/browser/test-session/frame?startUrl=https://example.com",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; imageBase64: string; mock: boolean };
    expect(body.ok).toBe(true);
    expect(body.mock).toBe(true);
    expect(body.imageBase64.length).toBeGreaterThan(10);
  });

  it("POST input click returns updated frame", async () => {
    await app.request("/api/desktop/browser/s2/ensure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startUrl: "https://example.com" }),
    });
    const res = await app.request("/api/desktop/browser/s2/input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "click", x: 50, y: 60 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; frame: { imageBase64: string } };
    expect(body.ok).toBe(true);
    expect(body.frame.imageBase64.length).toBeGreaterThan(10);
  });

  it("GET dom returns page snapshot in mock mode", async () => {
    await app.request("/api/desktop/browser/s3/ensure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startUrl: "https://example.com" }),
    });
    const res = await app.request("/api/desktop/browser/s3/dom");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; dom: { url: string; text: string } };
    expect(body.ok).toBe(true);
    expect(body.dom.url).toContain("example.com");
    expect(typeof body.dom.text).toBe("string");
  });

  it("GET network returns request log array", async () => {
    await app.request("/api/desktop/browser/s4/ensure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startUrl: "https://example.com" }),
    });
    const res = await app.request("/api/desktop/browser/s4/network");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; entries: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.entries)).toBe(true);
  });
});

describe("browser slot create", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "openx-browser-route-"));
    process.env.OPENX_CONFIG_PATH = join(tempDir, "config.json");
    process.env.OPENX_BROWSER_MOCK = "1";
  });

  afterEach(async () => {
    await closeAllBrowserSessions();
    delete process.env.OPENX_CONFIG_PATH;
    delete process.env.OPENX_BROWSER_MOCK;
  });

  it("creates browser slot with sessionId", async () => {
    const res = await app.request("/api/desktop/slots?scope=console", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "browser",
        config: { kind: "browser", startUrl: "https://example.com" },
        pinCol: 0,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      slotId: string;
      catalog: { slots: { config: { sessionId?: string } }[] };
    };
    const slot = body.catalog.slots.find((s) => s.config);
    expect(body.catalog.slots[0]?.config.sessionId).toBe(body.slotId);
  });
});
