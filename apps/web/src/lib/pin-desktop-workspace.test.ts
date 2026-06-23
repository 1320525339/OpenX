import { describe, expect, it } from "vitest";
import { columnSpan, emptyPinLayout, extensionSlotColumn, normalizeLayout, setPinSpan, togglePinWidget } from "./pin-desktop";
import {
  applySeamResizeCommit,
  buildPinSeams,
  computeSeamResizePreview,
} from "./pin-desktop-seam";
import {
  emptyPinWorkspace,
  pageCount,
  pinSlotAtColumnInWorkspace,
  pinSlotInWorkspace,
  pinnedWidgetsInWorkspace,
  normalizeWorkspace,
  setActivePage,
  togglePinInWorkspace,
  updateActivePageLayout,
} from "./pin-desktop-workspace";
import {
  addWebCardToCatalog,
  emptyOxspCatalog,
  extWidgetId,
  normalizeExtensionUrl,
  PIN_EXTENSION_DEMO_URL,
} from "./oxsp-catalog";

describe("pin-desktop-workspace", () => {
  it("fills first page then opens second page for fourth pin", () => {
    let ws = emptyPinWorkspace();
    ws = togglePinInWorkspace(ws, "chat");
    ws = togglePinInWorkspace(ws, "evidence");
    ws = togglePinInWorkspace(ws, "tasks");
    expect(pageCount(ws)).toBe(1);
    expect(ws.pages[0]!.cols).toEqual(["chat", "evidence", "tasks"]);

    ws = togglePinInWorkspace(ws, "detail");
    expect(pageCount(ws)).toBe(2);
    expect(ws.activePage).toBe(1);
    expect(ws.pages[1]!.cols[0]).toBe("detail");
    expect(pinnedWidgetsInWorkspace(ws)).toEqual(["chat", "evidence", "tasks", "detail"]);
  });

  it("cycles pages in a loop", () => {
    let ws = emptyPinWorkspace();
    ws = togglePinInWorkspace(ws, "chat");
    ws = togglePinInWorkspace(ws, "evidence");
    ws = togglePinInWorkspace(ws, "tasks");
    ws = togglePinInWorkspace(ws, "detail");

    ws = setActivePage(ws, 0);
    expect(ws.activePage).toBe(0);
    ws = setActivePage(ws, 2);
    expect(ws.activePage).toBe(0);
    ws = setActivePage(ws, -1);
    expect(ws.activePage).toBe(1);
  });

  it("does not replace widgets when single page is full", () => {
    let layout = emptyPinLayout();
    layout = togglePinWidget(layout, "chat");
    layout = togglePinWidget(layout, "evidence");
    layout = togglePinWidget(layout, "tasks");
    const blocked = togglePinWidget(layout, "detail");
    expect(blocked.cols).toEqual(["chat", "evidence", "tasks"]);
  });

  it("pins web cards without toggling off", () => {
    const { widgetId } = addWebCardToCatalog(emptyOxspCatalog(), "https://example.com");
    let ws = pinSlotInWorkspace(emptyPinWorkspace(), widgetId);
    expect(ws.pages[0]!.cols[0]).toBe(widgetId);
    ws = pinSlotInWorkspace(ws, widgetId);
    expect(ws.pages[0]!.cols[0]).toBe(widgetId);
  });

  it("preserves span-3 layout through workspace normalize", () => {
    const layout = setPinSpan(
      { ...emptyPinLayout(), cols: ["chat", null, null] },
      0,
      3,
    );
    let ws = updateActivePageLayout(emptyPinWorkspace(), layout);
    expect(ws.pages[0]!.wide).toEqual([true, false, true]);
    expect(columnSpan(ws.pages[0]!, 0)).toBe(3);

    ws = normalizeWorkspace(ws);
    expect(ws.pages[0]!.wide).toEqual([true, false, true]);
    expect(columnSpan(ws.pages[0]!, 0)).toBe(3);
  });

  it("preserves span-3 through seam commit and workspace update", () => {
    const layout = normalizeLayout({
      cols: ["chat", null, "detail"],
      wide: [true, false, false],
    });
    const rect = {
      left: 100,
      width: 300,
      top: 0,
      height: 200,
      right: 400,
      bottom: 200,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
    const seam = buildPinSeams(layout)[0]!;
    const preview = computeSeamResizePreview({
      seam,
      clientX: 360,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    const committed = applySeamResizeCommit(layout, seam, preview);
    const ws = updateActivePageLayout(emptyPinWorkspace(), committed);
    expect(ws.pages[0]!.wide).toEqual([true, false, true]);
    expect(columnSpan(ws.pages[0]!, 0)).toBe(3);
  });

  it("preserves sparse page column positions", () => {
    const ws = normalizeWorkspace({
      activePage: 0,
      pages: [
        {
          ...emptyPinLayout(),
          cols: [null, null, "evidence"],
        },
      ],
    });

    expect(ws.pages[0]!.cols).toEqual([null, null, "evidence"]);
  });

  it("pins web card at extension column", () => {
    const { widgetId } = addWebCardToCatalog(emptyOxspCatalog(), "https://example.com");
    let layout = emptyPinLayout();
    layout = togglePinWidget(layout, "chat");
    const col = extensionSlotColumn(layout);
    expect(col).toBe(1);
    let ws = emptyPinWorkspace();
    ws = { ...ws, pages: [layout] };
    ws = pinSlotAtColumnInWorkspace(ws, widgetId, col!);
    expect(ws.pages[0]!.cols[1]).toBe(widgetId);
  });

  it("does not pin web card when target column is occupied", () => {
    const { widgetId } = addWebCardToCatalog(emptyOxspCatalog(), "https://example.com");
    let layout = emptyPinLayout();
    layout = togglePinWidget(layout, "chat");
    layout = togglePinWidget(layout, "tasks");
    let ws = emptyPinWorkspace();
    ws = { ...ws, pages: [layout] };
    const before = ws.pages[0]!.cols;
    ws = pinSlotAtColumnInWorkspace(ws, widgetId, 0);
    expect(ws.pages[0]!.cols).toEqual(before);
  });

  it("places extension slot in first spatial empty column", () => {
    const gapped = normalizeLayout({
      cols: ["chat", null, "detail"],
      wide: [false, false, false],
    });
    expect(extensionSlotColumn(gapped)).toBe(1);
  });

  it("places extension slot after filled cards", () => {
    let layout = emptyPinLayout();
    expect(extensionSlotColumn(layout)).toBe(0);

    layout = togglePinWidget(layout, "chat");
    expect(extensionSlotColumn(layout)).toBe(1);

    layout = togglePinWidget(layout, "tasks");
    expect(extensionSlotColumn(layout)).toBe(2);

    layout = togglePinWidget(layout, "evidence");
    expect(extensionSlotColumn(layout)).toBe(null);
  });
});

describe("pin-desktop-extension", () => {
  const base = "http://localhost:5173/app/";

  it("normalizes absolute and relative urls", () => {
    expect(normalizeExtensionUrl("https://example.com", base)).toBe("https://example.com");
    expect(normalizeExtensionUrl("/index.html", base)).toBe("http://localhost:5173/index.html");
    expect(normalizeExtensionUrl("./page.html", base)).toBe("http://localhost:5173/app/page.html");
    expect(normalizeExtensionUrl("example.com/docs", base)).toBe("https://example.com/docs");
    expect(normalizeExtensionUrl("127.0.0.1:5173/demo", base)).toBe("http://127.0.0.1:5173/demo");
    expect(normalizeExtensionUrl(PIN_EXTENSION_DEMO_URL, base)).toBe(
      "http://localhost:5173/demo/crew-game/",
    );
  });

  it("creates unique web card slots", () => {
    const first = addWebCardToCatalog(emptyOxspCatalog(), "https://a.test");
    const second = addWebCardToCatalog(first.catalog, "https://b.test");
    expect(first.widgetId).not.toBe(second.widgetId);
    expect(extWidgetId(first.slot.id)).toBe(first.widgetId);
  });
});
