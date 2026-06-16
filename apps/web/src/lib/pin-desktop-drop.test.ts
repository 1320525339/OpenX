import { describe, expect, it } from "vitest";
import {
  applyPinDropIntent,
  createPinDropTargetTracker,
  dropZoneFromCellRect,
  PIN_DROP_ZONE_DWELL_MS,
  placePinWidgetAtDrop,
  resolvePinDropTarget,
} from "./pin-desktop-drop";
import { emptyPinLayout, normalizeLayout, togglePinWidget } from "./pin-desktop";

function layoutWith(
  cols: Array<string | null>,
  opts?: { split?: boolean[]; splitBottom?: Array<string | null> },
) {
  const base = emptyPinLayout();
  return normalizeLayout({
    cols: cols as typeof base.cols,
    wide: base.wide,
    split: opts?.split ?? base.split,
    splitBottom: (opts?.splitBottom ?? base.splitBottom) as typeof base.splitBottom,
  });
}

describe("pin-desktop-drop", () => {
  it("classifies Y thirds inside a cell rect", () => {
    const rect = { top: 100, height: 300 } as DOMRect;
    expect(dropZoneFromCellRect(rect, 120)).toBe("stack-above");
    expect(dropZoneFromCellRect(rect, 200)).toBe("replace");
    expect(dropZoneFromCellRect(rect, 310)).toBe("stack-below");
  });

  it("stacks dragged widget above incumbent", () => {
    const layout = layoutWith(["chat", "kanban", "tasks"]);
    const next = applyPinDropIntent(layout, "tasks", 1, "stack-above");
    expect(next.cols[1]).toBe("tasks");
    expect(next.split[1]).toBe(true);
    expect(next.splitBottom[1]).toBe("kanban");
    expect(next.cols[2]).toBe(null);
  });

  it("stacks dragged widget below incumbent", () => {
    const layout = layoutWith(["chat", "kanban", "tasks"]);
    const next = applyPinDropIntent(layout, "tasks", 1, "stack-below");
    expect(next.cols[1]).toBe("kanban");
    expect(next.split[1]).toBe(true);
    expect(next.splitBottom[1]).toBe("tasks");
    expect(next.cols[2]).toBe(null);
  });

  it("replaces column bundle on middle zone", () => {
    const layout = layoutWith(["chat", "kanban", "tasks"]);
    const next = applyPinDropIntent(layout, "chat", 2, "replace");
    expect(next.cols).toEqual(["tasks", "kanban", "chat"]);
  });

  it("pins from dock and stacks above target", () => {
    let layout = layoutWith(["chat", "kanban", null]);
    layout = togglePinWidget(layout, "tasks");
    expect(layout.cols[2]).toBe("tasks");
    const next = placePinWidgetAtDrop(layout, "tasks", 1, "stack-above");
    expect(next.cols[1]).toBe("tasks");
    expect(next.splitBottom[1]).toBe("kanban");
    expect(next.cols[2]).toBe(null);
  });

  it("replaces incumbent when dragging unpinned dock tab onto occupied column", () => {
    const layout = layoutWith(["chat", "kanban", "tasks"]);
    const next = placePinWidgetAtDrop(layout, "detail", 0, "replace");
    expect(next.cols[0]).toBe("detail");
    expect(next.cols[1]).toBe("kanban");
    expect(next.cols[2]).toBe("tasks");
    expect(next.cols.includes("chat")).toBe(false);
  });

  it("replaces incumbent when dragging pinned dock tab onto another occupied column", () => {
    const layout = layoutWith(["chat", "kanban", "tasks"]);
    const next = placePinWidgetAtDrop(layout, "tasks", 0, "replace");
    expect(next.cols[0]).toBe("tasks");
    expect(next.cols[1]).toBe("kanban");
    expect(next.cols[2]).toBe(null);
    expect(next.cols.includes("chat")).toBe(false);
  });

  it("replaces stacked column when dropping dock tab on occupied stack", () => {
    const layout = layoutWith(["chat", "kanban", "tasks"], {
      split: [false, true, false],
      splitBottom: [null, "detail", null],
    });
    const next = placePinWidgetAtDrop(layout, "tasks", 1, "replace");
    expect(next.cols[1]).toBe("tasks");
    expect(next.split[1]).toBe(false);
    expect(next.splitBottom[1]).toBe(null);
    expect(next.cols.includes("kanban")).toBe(false);
    expect(next.cols.includes("detail")).toBe(false);
  });

  it("resolvePinDropTarget uses replace for empty column", () => {
    const layout = layoutWith(["chat", null, null]);
    const gridRect = { left: 0, width: 300 } as DOMRect;
    const target = resolvePinDropTarget({
      gridRect,
      cellRect: null,
      clientX: 250,
      clientY: 100,
      layout,
    });
    expect(target).toEqual({ col: 2, zone: "replace" });
  });

  it("resolvePinDropTarget uses replace while passing over occupied column", () => {
    const layout = layoutWith(["chat", "kanban", null]);
    const gridRect = { left: 0, width: 300 } as DOMRect;
    const cellRect = { top: 0, height: 90 } as DOMRect;
    const target = resolvePinDropTarget({
      gridRect,
      cellRect,
      clientX: 150,
      clientY: 10,
      layout,
    });
    expect(target).toEqual({ col: 1, zone: "replace" });
  });

  it("resolvePinDropTarget uses Y zone after dwell armed", () => {
    const layout = layoutWith(["chat", "kanban", null]);
    const gridRect = { left: 0, width: 300 } as DOMRect;
    const cellRect = { top: 0, height: 90 } as DOMRect;
    const target = resolvePinDropTarget({
      gridRect,
      cellRect,
      clientX: 150,
      clientY: 10,
      layout,
      dwellArmed: true,
    });
    expect(target).toEqual({ col: 1, zone: "stack-above" });
  });

  it("tracker keeps replace until pointer dwells on a column", () => {
    const layout = layoutWith(["chat", "kanban", null]);
    const gridRect = { left: 0, width: 300 } as DOMRect;
    const cellRect = { top: 0, height: 90 } as DOMRect;
    const tracker = createPinDropTargetTracker(200);
    const params = {
      gridRect,
      cellRect,
      clientX: 150,
      clientY: 10,
      layout,
    };
    expect(tracker.resolve(params, 0)).toEqual({ col: 1, zone: "replace" });
    expect(tracker.resolve(params, 100)).toEqual({ col: 1, zone: "replace" });
    expect(tracker.resolve(params, 250)).toEqual({ col: 1, zone: "stack-above" });
    expect(tracker.resolve({ ...params, clientY: 80 }, 300)).toEqual({
      col: 1,
      zone: "stack-below",
    });
    expect(PIN_DROP_ZONE_DWELL_MS).toBeGreaterThan(0);
  });
});
