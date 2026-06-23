import { describe, expect, it } from "vitest";
import {
  buildLogicalGridTemplate,
  buildPinSegments,
  compactPinLayout,
  columnSpan,
  emptyPinLayout,
  extensionSlotColumn,
  extensionSlotColumns,
  getEmptyColumns,
  isWidgetPinned,
  migrateLegacyDockWidget,
  normalizeLayout,
  swapPinColumns,
  setPinSpan,
  shrinkCol0Span3To2,
  setPinWide,
  togglePinWidget,
  placePinWidgetAtColumn,
  widgetColumn,
} from "./pin-desktop.js";

describe("pin-desktop", () => {
  it("pins into first empty column without compacting", () => {
    let layout = emptyPinLayout();
    layout = togglePinWidget(layout, "chat");
    layout = togglePinWidget(layout, "evidence");
    expect(layout.cols).toEqual(["chat", "evidence", null]);
  });

  it("fills all three columns", () => {
    let layout = emptyPinLayout();
    layout = togglePinWidget(layout, "chat");
    layout = togglePinWidget(layout, "evidence");
    layout = togglePinWidget(layout, "tasks");
    expect(layout.cols).toEqual(["chat", "evidence", "tasks"]);
  });

  it("does not pin into a full single page layout", () => {
    let layout = emptyPinLayout();
    layout = togglePinWidget(layout, "chat");
    layout = togglePinWidget(layout, "evidence");
    layout = togglePinWidget(layout, "tasks");
    const blocked = togglePinWidget(layout, "detail");
    expect(blocked.cols).toEqual(["chat", "evidence", "tasks"]);
  });

  it("unpins without left compacting", () => {
    const layout = normalizeLayout({
      cols: ["chat", null, "evidence"],
      wide: [false, false, false],
    });
    const next = togglePinWidget(layout, "chat");
    expect(isWidgetPinned(next, "chat")).toBe(false);
    expect(next.cols).toEqual([null, null, "evidence"]);
  });

  it("wide pushes adjacent card to third column when a slot is free", () => {
    const layout = normalizeLayout({
      cols: ["chat", "tasks", null],
      wide: [false, false, false],
    });
    const next = setPinWide(layout, 0, true);
    expect(next.wide[0]).toBe(true);
    expect(next.cols).toEqual(["chat", null, "tasks"]);
    expect(isWidgetPinned(next, "tasks")).toBe(true);
  });

  it("pulls displaced neighbor back to middle when shrinking wide-left", () => {
    const layout = normalizeLayout({
      cols: ["chat", null, "tasks"],
      wide: [true, false, false],
    });
    const next = setPinSpan(layout, 0, 1);
    expect(next.cols).toEqual(["chat", "tasks", null]);
    expect(next.wide).toEqual([false, false, false]);
  });

  it("wide does not expand when neighbor cannot be pushed", () => {
    const layout = normalizeLayout({
      cols: ["chat", "tasks", "evidence"],
      wide: [false, false, false],
    });
    const blocked = setPinSpan(layout, 0, 2);
    expect(blocked).toEqual(layout);
  });

  it("wide spans three equal columns when both neighbors empty", () => {
    let layout = normalizeLayout({
      cols: ["chat", null, null],
      wide: [true, false, false],
    });
    layout = setPinSpan(layout, 0, 3);
    expect(layout.wide).toEqual([true, false, true]);
    expect(layout.cols).toEqual(["chat", null, null]);
    const segs = buildPinSegments(layout);
    expect(segs).toEqual([
      { kind: "widget", col: 0, colspan: 3, widget: "chat" },
    ]);
  });

  it("wide at column 1 pushes column 2 card to first empty slot", () => {
    const layout = normalizeLayout({
      cols: [null, "tasks", "evidence"],
      wide: [false, false, false],
    });
    const next = setPinWide(layout, 1, true);
    expect(next.wide[1]).toBe(true);
    expect(next.cols).toEqual(["evidence", "tasks", null]);
    expect(isWidgetPinned(next, "evidence")).toBe(true);
  });
  it("wide spans two equal columns and pushes neighbor to third", () => {
    let layout = normalizeLayout({
      cols: ["chat", "tasks", null],
      wide: [false, false, false],
    });
    layout = setPinWide(layout, 0, true);
    expect(layout.wide[0]).toBe(true);
    expect(layout.cols).toEqual(["chat", null, "tasks"]);
    const segs = buildPinSegments(layout);
    expect(segs).toEqual([
      { kind: "widget", col: 0, colspan: 2, widget: "chat" },
      { kind: "widget", col: 2, colspan: 1, widget: "tasks" },
    ]);
  });

  it("swaps widget with empty column", () => {
    const layout = normalizeLayout({
      cols: ["chat", null, "evidence"],
      wide: [false, false, false],
    });
    const next = swapPinColumns(layout, 0, 1);
    expect(next.cols).toEqual([null, "chat", "evidence"]);
  });

  it("swaps two widgets", () => {
    const layout = normalizeLayout({
      cols: ["chat", null, "evidence"],
      wide: [false, false, false],
    });
    const next = swapPinColumns(layout, 0, 2);
    expect(next.cols).toEqual(["evidence", null, "chat"]);
  });

  it("empty columns only exposed for drag targets", () => {
    expect(getEmptyColumns(emptyPinLayout())).toEqual([0, 1, 2]);
    expect(buildPinSegments(emptyPinLayout())).toEqual([]);
    expect(buildPinSegments(emptyPinLayout(), { includeEmpty: true })).toHaveLength(3);
  });

  it("extension slot uses spatial columns not compact layout", () => {
    const sparse = normalizeLayout({
      cols: [null, null, "evidence"],
      wide: [false, false, false],
    });
    expect(extensionSlotColumn(sparse)).toBe(0);
    expect(sparse.cols).toEqual([null, null, "evidence"]);

    const gapped = normalizeLayout({
      cols: ["chat", null, "detail"],
      wide: [false, false, false],
    });
    expect(extensionSlotColumn(gapped)).toBe(1);

    const wideGapped = normalizeLayout({
      cols: ["chat", null, "detail"],
      wide: [true, false, false],
    });
    expect(extensionSlotColumn(wideGapped)).toBe(null);
  });

  it("fills all empty columns for extension slots when requested", () => {
    const sparse = normalizeLayout({
      cols: ["chat", null, null],
      wide: [false, false, false],
    });
    expect(extensionSlotColumns(sparse)).toEqual([1]);
    expect(extensionSlotColumns(sparse, { fillAllEmpty: true })).toEqual([1, 2]);
  });

  it("hides extension slots under wide middle column", () => {
    const wideMiddle = normalizeLayout({
      cols: ["chat", "tasks", null],
      wide: [false, true, false],
    });
    expect(extensionSlotColumn(wideMiddle)).toBe(null);
    expect(extensionSlotColumns(wideMiddle, { fillAllEmpty: true })).toEqual([]);
    expect(getEmptyColumns(wideMiddle)).toEqual([]);
  });

  it("shrinks span-3 to span-2 via dedicated helper", () => {
    let layout = normalizeLayout({
      cols: ["chat", null, "detail"],
      wide: [true, false, false],
    });
    layout = setPinSpan(layout, 0, 3);
    expect(columnSpan(layout, 0)).toBe(3);
    const shrunk = shrinkCol0Span3To2(layout);
    expect(shrunk.wide).toEqual([true, false, false]);
    expect(shrunk.cols).toEqual(["chat", null, "detail"]);
    expect(columnSpan(shrunk, 0)).toBe(2);
  });

  it("keeps three equal fixed tracks at rest (no 2-card equal split)", () => {
    const sparse = normalizeLayout({
      cols: ["chat", null, "evidence"],
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
      cols: ["chat", null, "evidence"],
      wide: [false, false, false],
    });
    const next = placePinWidgetAtColumn(layout, "tasks", 0);
    expect(widgetColumn(next, "tasks")).toBe(0);
    expect(widgetColumn(next, "chat")).toBe(1);
    expect(widgetColumn(next, "evidence")).toBe(2);
  });

  it("moves pinned widget to target column", () => {
    const layout = normalizeLayout({
      cols: ["chat", "tasks", "evidence"],
      wide: [false, false, false],
    });
    const next = placePinWidgetAtColumn(layout, "evidence", 0);
    expect(next.cols).toEqual(["evidence", "tasks", "chat"]);
  });

  it("migrates legacy kanban slot to tasks", () => {
    const layout = normalizeLayout({
      cols: ["chat", "kanban" as never, "detail"],
      wide: [false, false, false],
    });
    expect(layout.cols).toEqual(["chat", "tasks", "detail"]);
    expect(migrateLegacyDockWidget("kanban" as never)).toBe("tasks");
  });
});
