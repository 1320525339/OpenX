import { describe, expect, it } from "vitest";
import { emptyPinLayout, extensionSlotColumn, togglePinWidget } from "./pin-desktop";
import {
  emptyPinWorkspace,
  pageCount,
  pinSlotAtColumnInWorkspace,
  pinSlotInWorkspace,
  pinnedWidgetsInWorkspace,
  setActivePage,
  togglePinInWorkspace,
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
    ws = togglePinInWorkspace(ws, "kanban");
    ws = togglePinInWorkspace(ws, "tasks");
    expect(pageCount(ws)).toBe(1);
    expect(ws.pages[0]!.cols).toEqual(["chat", "kanban", "tasks"]);

    ws = togglePinInWorkspace(ws, "detail");
    expect(pageCount(ws)).toBe(2);
    expect(ws.activePage).toBe(1);
    expect(ws.pages[1]!.cols[0]).toBe("detail");
    expect(pinnedWidgetsInWorkspace(ws)).toEqual(["chat", "kanban", "tasks", "detail"]);
  });

  it("cycles pages in a loop", () => {
    let ws = emptyPinWorkspace();
    ws = togglePinInWorkspace(ws, "chat");
    ws = togglePinInWorkspace(ws, "kanban");
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
    layout = togglePinWidget(layout, "kanban");
    layout = togglePinWidget(layout, "tasks");
    const blocked = togglePinWidget(layout, "detail");
    expect(blocked.cols).toEqual(["chat", "kanban", "tasks"]);
  });

  it("pins web cards without toggling off", () => {
    const { widgetId } = addWebCardToCatalog(emptyOxspCatalog(), "https://example.com");
    let ws = pinSlotInWorkspace(emptyPinWorkspace(), widgetId);
    expect(ws.pages[0]!.cols[0]).toBe(widgetId);
    ws = pinSlotInWorkspace(ws, widgetId);
    expect(ws.pages[0]!.cols[0]).toBe(widgetId);
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

  it("places extension slot after filled cards", () => {
    let layout = emptyPinLayout();
    expect(extensionSlotColumn(layout)).toBe(0);

    layout = togglePinWidget(layout, "chat");
    expect(extensionSlotColumn(layout)).toBe(1);

    layout = togglePinWidget(layout, "tasks");
    expect(extensionSlotColumn(layout)).toBe(2);

    layout = togglePinWidget(layout, "kanban");
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
