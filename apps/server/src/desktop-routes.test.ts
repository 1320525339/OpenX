import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { app } from "./routes.js";

describe("desktop routes", () => {
  let tempDir = "";
  const jsonHeaders = { "Content-Type": "application/json" };
  const prevHome = process.env.OPENX_HOME;
  const prevConfig = process.env.OPENX_CONFIG_PATH;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "openx-desktop-route-test-"));
    process.env.OPENX_HOME = tempDir;
    process.env.OPENX_CONFIG_PATH = join(tempDir, "config.json");
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.OPENX_HOME;
    else process.env.OPENX_HOME = prevHome;
    if (prevConfig === undefined) delete process.env.OPENX_CONFIG_PATH;
    else process.env.OPENX_CONFIG_PATH = prevConfig;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("GET /api/desktop/slots returns empty bundle", async () => {
    const res = await app.request("/api/desktop/slots?scope=console");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      revision: number;
      scope: string;
      catalog: { slots: unknown[] };
      pinnedWidgets: unknown[];
    };
    expect(body.scope).toBe("console");
    expect(body.revision).toBe(0);
    expect(body.catalog.slots).toEqual([]);
    expect(body.pinnedWidgets).toEqual([]);
  });

  it("POST /api/desktop/slots creates and pins a web slot", async () => {
    const res = await app.request("/api/desktop/slots?scope=console", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        kind: "web",
        config: { kind: "web", url: "https://example.com" },
        pinCol: 0,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      slotId: string;
      widgetId: string;
      catalog: { slots: { id: string }[] };
      pinnedWidgets: string[];
    };
    expect(body.ok).toBe(true);
    expect(body.widgetId).toBe(`ext:${body.slotId}`);
    expect(body.catalog.slots.some((s) => s.id === body.slotId)).toBe(true);
    expect(body.pinnedWidgets).toContain(body.widgetId);
  });

  it("POST command set_url updates slot url", async () => {
    const createRes = await app.request("/api/desktop/slots?scope=console", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        kind: "web",
        config: { kind: "web", url: "https://example.com" },
        pinCol: 0,
      }),
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { slotId: string; revision: number };

    const cmdRes = await app.request(
      `/api/desktop/slots/${created.slotId}/command?scope=console`,
      {
        method: "POST",
        headers: {
          ...jsonHeaders,
          "x-openx-desktop-revision": String(created.revision),
        },
        body: JSON.stringify({ action: "set_url", url: "https://updated.example.com" }),
      },
    );
    expect(cmdRes.status).toBe(200);
    const cmdBody = (await cmdRes.json()) as {
      catalog: { slots: { id: string; config: { kind: string; url?: string } }[] };
    };
    const slot = cmdBody.catalog.slots.find((s) => s.id === created.slotId);
    expect(slot?.config).toEqual({ kind: "web", url: "https://updated.example.com" });
  });

  it("POST command snapshot returns snapshotText", async () => {
    const createRes = await app.request("/api/desktop/slots?scope=console", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        kind: "web",
        config: { kind: "web", url: "https://example.com/docs" },
        pinCol: 0,
      }),
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { slotId: string; revision: number };

    const snapRes = await app.request(
      `/api/desktop/slots/${created.slotId}/command?scope=console`,
      {
        method: "POST",
        headers: {
          ...jsonHeaders,
          "x-openx-desktop-revision": String(created.revision),
        },
        body: JSON.stringify({ action: "snapshot" }),
      },
    );
    expect(snapRes.status).toBe(200);
    const snapBody = (await snapRes.json()) as {
      result: { slotId: string; snapshotText: string; kind: string };
    };
    expect(snapBody.result.slotId).toBe(created.slotId);
    expect(snapBody.result.kind).toBe("web");
    expect(snapBody.result.snapshotText).toContain("example.com");
  });

  it("DELETE /api/desktop/slots/:slotId removes slot", async () => {
    const createRes = await app.request("/api/desktop/slots?scope=console", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        kind: "web",
        config: { kind: "web", url: "https://example.com" },
        pinCol: 0,
      }),
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { slotId: string; revision: number };

    const delRes = await app.request(`/api/desktop/slots/${created.slotId}?scope=console`, {
      method: "DELETE",
      headers: { "x-openx-desktop-revision": String(created.revision) },
    });
    expect(delRes.status).toBe(200);
    const delBody = (await delRes.json()) as { catalog: { slots: unknown[] } };
    expect(delBody.catalog.slots).toEqual([]);
  });
});
