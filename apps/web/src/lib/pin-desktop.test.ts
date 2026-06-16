import { describe, expect, it } from "vitest";
import {
  buildLogicalGridTemplate,
  buildPinSegments,
  emptyPinLayout,
  isWidgetPinned,
  normalizeLayout,
  swapPinColumns,
  setPinWide,
  togglePinWidget,
  getEmptyColumns,
  placePinWidgetAtColumn,
  widgetColumn,
} from "./pin-desktop.js";

describe("pin-desktop", () => {
  it("pins into first empty column without compacting", () => {
    let layout = emptyPinLayout();
    layout = togglePinWidget(layout, "chat");
    layout = togglePinWidget(layout, "kanban");
    expect(layout.cols).toEqual(["chat", "kanban", null]);
  });

  it("fills all three columns", () => {
    let layout = emptyPinLayout();
    layout = togglePinWidget(layout, "chat");
    layout = togglePinWidget(layout, "kanban");
    layout = togglePinWidget(layout, "tasks");
    expect(layout.cols).toEqual(["chat", "kanban", "tasks"]);
  });

  it("does not pin into a full single page layout", () => {
    let layout = emptyPinLayout();
    layout = togglePinWidget(layout, "chat");
    layout = togglePinWidget(layout, "kanban");
    layout = togglePinWidget(layout, "tasks");
    const blocked = togglePinWidget(layout, "detail");
    expect(blocked.cols).toEqual(["chat", "kanban", "tasks"]);
  });

  it("unpins without left compacting", () => {
    const layout = normalizeLayout({
      cols: ["chat", null, "kanban"],
      wide: [false, false, false],
    });
    const next = togglePinWidget(layout, "chat");
    expect(isWidgetPinned(next, "chat")).toBe(false);
    expect(next.cols).toEqual([null, null, "kanban"]);
  });

  it("wide consumes adjacent card and keeps third column", () => {
    const layout = normalizeLayout({
      cols: ["chat", "tasks", "kanban"],
      wide: [false, false, false],
    });
    const next = setPinWide(layout, 0, true);
    expect(next.wide[0]).toBe(true);
    expect(next.cols).toEqual(["chat", null, "kanban"]);
    expect(isWidgetPinned(next, "tasks")).toBe(false);
    expect(isWidgetPinned(next, "kanban")).toBe(true);
  });

  it("wide at column 1 consumes column 2", () => {
    const layout = normalizeLayout({
      cols: ["chat", "tasks", "kanban"],
      wide: [false, false, false],
    });
    const next = setPinWide(layout, 1, true);
    expect(next.wide[1]).toBe(true);
    expect(next.cols).toEqual(["chat", "tasks", null]);
    expect(isWidgetPinned(next, "kanban")).toBe(false);
  });
  it("wide spans two equal columns when neighbor empty", () => {
    let layout = normalizeLayout({
      cols: ["chat", "tasks", null],
      wide: [false, false, false],
    });
    layout = setPinWide(layout, 0, true);
    expect(layout.wide[0]).toBe(true);
    expect(layout.cols).toEqual(["chat", null, null]);
    const segs = buildPinSegments(layout);
    expect(segs).toEqual([
      { kind: "widget", col: 0, colspan: 2, widget: "chat" },
    ]);
  });

  it("swaps widget with empty column", () => {
    const layout = normalizeLayout({
      cols: ["chat", null, "kanban"],
      wide: [false, false, false],
    });
    const next = swapPinColumns(layout, 0, 1);
    expect(next.cols).toEqual([null, "chat", "kanban"]);
  });

  it("swaps two widgets", () => {
    const layout = normalizeLayout({
      cols: ["chat", null, "kanban"],
      wide: [false, false, false],
    });
    const next = swapPinColumns(layout, 0, 2);
    expect(next.cols).toEqual(["kanban", null, "chat"]);
  });

  it("empty columns only exposed for drag targets", () => {
    expect(getEmptyColumns(emptyPinLayout())).toEqual([0, 1, 2]);
    expect(buildPinSegments(emptyPinLayout())).toEqual([]);
    expect(buildPinSegments(emptyPinLayout(), { includeEmpty: true })).toHaveLength(3);
  });

  it("keeps three equal fixed tracks at rest (no 2-card equal split)", () => {
    const sparse = normalizeLayout({
      cols: ["chat", null, "kanban"],
      wide: [false, false, false],
    });
    expect(buildLogicalGridTemplate(sparse)).toBe(
      "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)",
    );
    expect(buildLogicalGridTemplate(sparse, { showEmptyColumns: true })).toBe(
      "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)",
    );
  });

  it("wide card still uses fixed three-column grid", () => {
    const wideOnly = normalizeLayout({
      cols: ["chat", null, null],
      wide: [true, false, false],
    });
    expect(buildLogicalGridTemplate(wideOnly)).toBe(
      "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)",
    );
  });

  it("places unpinned widget at target column via swap", () => {
    const layout = normalizeLayout({
      cols: ["chat", null, "kanban"],
      wide: [false, false, false],
    });
    const next = placePinWidgetAtColumn(layout, "tasks", 0);
    expect(widgetColumn(next, "tasks")).toBe(0);
    expect(widgetColumn(next, "chat")).toBe(1);
    expect(widgetColumn(next, "kanban")).toBe(2);
  });

  it("moves pinned widget to target column", () => {
    const layout = normalizeLayout({
      cols: ["chat", "tasks", "kanban"],
      wide: [false, false, false],
    });
    const next = placePinWidgetAtColumn(layout, "kanban", 0);
    expect(next.cols).toEqual(["kanban", "tasks", "chat"]);
  });
});
