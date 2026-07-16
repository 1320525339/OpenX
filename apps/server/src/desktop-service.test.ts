import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createOxspSlot,
  getDesktopBundle,
  runOxspSlotCommand,
} from "./desktop-service.js";

describe("desktop-service", () => {
  let tempDir = "";
  const prevHome = process.env.OPENX_HOME;
  const prevConfig = process.env.OPENX_CONFIG_PATH;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "openx-desktop-test-"));
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

  it("creates and snapshots a web slot", async () => {
    const { bundle, slotId } = createOxspSlot("console", {
      kind: "web",
      config: { kind: "web", url: "https://example.com" },
      pinCol: 0,
    });
    expect(bundle.catalog.slots.some((s) => s.id === slotId)).toBe(true);
    expect(bundle.pinnedWidgets.some((w) => w === `ext:${slotId}`)).toBe(true);

    const { result } = await runOxspSlotCommand("console", slotId, { action: "snapshot" });
    expect(result).toMatchObject({ slotId, kind: "web" });
  });

  it("updates web url via command", async () => {
    const { slotId } = createOxspSlot("console", {
      kind: "web",
      config: { kind: "web", url: "https://example.com" },
      pinCol: 0,
    });
    await runOxspSlotCommand("console", slotId, {
      action: "set_url",
      url: "https://updated.example.com",
    });
    const bundle = getDesktopBundle("console");
    const slot = bundle.catalog.slots.find((s) => s.id === slotId);
    expect(slot?.config).toEqual({ kind: "web", url: "https://updated.example.com" });
  });
});
