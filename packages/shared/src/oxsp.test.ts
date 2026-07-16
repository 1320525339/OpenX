import { describe, expect, it } from "vitest";

import {

  addOxspSlot,

  buildDefaultConfigForKind,

  emptyOxspCatalog,

  extWidgetId,

  migrateLegacyWebCards,

  normalizeOxspUrl,

  OXSP_DEMO_BROWSER_URL,

  OXSP_DOCK_TEMPLATES,

  resolveTemplateConfig,

  updateOxspSlot,

} from "./oxsp.js";

import {

  emptyPinWorkspace,

  extensionSlotColumn,

  isWidgetPinnedInWorkspace,

  pinSlotAtColumnInWorkspace,

  widgetIdForSlotId,

} from "./oxsp-layout.js";



describe("oxsp", () => {

  it("normalizes urls", () => {

    const base = "http://localhost:5173/app/";

    expect(normalizeOxspUrl("https://example.com", base)).toBe("https://example.com");

    expect(normalizeOxspUrl("/index.html", base)).toBe("http://localhost:5173/index.html");

    expect(normalizeOxspUrl("127.0.0.1:5173/demo", base)).toBe("http://127.0.0.1:5173/demo");

    expect(normalizeOxspUrl(OXSP_DEMO_BROWSER_URL, base)).toBe("http://localhost:5173/demo/crew-game/");

  });



  it("creates ext widget ids", () => {

    const { slot, widgetId } = addOxspSlot(emptyOxspCatalog(), {

      kind: "browser",

      startUrl: "https://a.test",

    });

    expect(widgetId).toBe(extWidgetId(slot.id));

  });



  it("migrates legacy web cards to browser slots", () => {

    const catalog = migrateLegacyWebCards({

      cards: [{ id: "w-1", url: "https://x.test", title: "X" }],

    });

    expect(catalog.slots).toHaveLength(1);

    expect(catalog.slots[0]?.config.kind).toBe("browser");

    expect(catalog.slots[0]?.config).toMatchObject({

      kind: "browser",

      startUrl: "https://x.test",

    });

  });



  it("resolves dock templates", () => {
    expect(OXSP_DOCK_TEMPLATES.some((t) => t.id === "web")).toBe(false);
    expect(OXSP_DOCK_TEMPLATES.some((t) => t.id === "demo-game")).toBe(false);
    expect(OXSP_DOCK_TEMPLATES.some((t) => t.id === "genshin-web")).toBe(false);
    const browser = resolveTemplateConfig("browser");
    expect(browser?.kind).toBe("browser");
    expect(browser && "startUrl" in browser ? browser.startUrl : undefined).toBeUndefined();
    expect(OXSP_DOCK_TEMPLATES.some((t) => t.id === "markdown")).toBe(false);
  });



  it("builds empty browser config by default", () => {

    expect(buildDefaultConfigForKind("browser")).toEqual({ kind: "browser" });

    expect(buildDefaultConfigForKind("browser", { startUrl: "https://example.com" })).toEqual({

      kind: "browser",

      startUrl: "https://example.com",

    });

  });



  it("updates slot config", () => {

    const { catalog, slot } = addOxspSlot(emptyOxspCatalog(), buildDefaultConfigForKind("browser"));

    const next = updateOxspSlot(catalog, slot.id, {

      config: { kind: "browser", startUrl: "https://updated.test" },

    });

    expect(next.slots[0]?.config).toEqual({ kind: "browser", startUrl: "https://updated.test" });

  });

});



describe("oxsp-layout", () => {

  it("pins ext slot at extension column", () => {

    const { slot, widgetId } = addOxspSlot(emptyOxspCatalog(), {

      kind: "browser",

      startUrl: "https://example.com",

    });

    let ws = emptyPinWorkspace();

    const col = extensionSlotColumn(ws.pages[0]!);

    expect(col).toBe(0);

    ws = pinSlotAtColumnInWorkspace(ws, widgetId, col!);

    expect(isWidgetPinnedInWorkspace(ws, widgetId)).toBe(true);

    expect(widgetIdForSlotId(slot.id)).toBe(widgetId);

  });

});

