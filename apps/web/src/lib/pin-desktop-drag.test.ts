import { describe, expect, it } from "vitest";
import {
  columnFromPointer,
  computeResizePreview,
} from "./pin-desktop-drag.js";

describe("pin-desktop-drag", () => {
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

  it("maps pointer x to three equal columns", () => {
    expect(columnFromPointer(rect, 120, 8)).toBe(0);
    expect(columnFromPointer(rect, 210, 8)).toBe(1);
    expect(columnFromPointer(rect, 320, 8)).toBe(2);
  });

  it("follows pointer width and hides neighbor only after midpoint", () => {
    const narrow = computeResizePreview({
      col: 0,
      clientX: 220,
      gridRect: rect,
      gapPx: 8,
      adjacentWidget: "tasks",
    });
    expect(narrow?.commitWide).toBe(false);
    expect(narrow?.hideNeighbor).toBe(false);
    expect(narrow?.previewWidth).toBeCloseTo(120, 0);

    const wide = computeResizePreview({
      col: 0,
      clientX: 260,
      gridRect: rect,
      gapPx: 8,
      adjacentWidget: "tasks",
    });
    expect(wide?.commitWide).toBe(true);
    expect(wide?.hideNeighbor).toBe(true);
    expect(wide?.previewWidth).toBeCloseTo(160, 0);
  });

  it("expands into empty slot without hiding neighbor", () => {
    const preview = computeResizePreview({
      col: 0,
      clientX: 260,
      gridRect: rect,
      gapPx: 8,
      adjacentWidget: null,
    });
    expect(preview?.commitWide).toBe(true);
    expect(preview?.hideNeighbor).toBe(false);
  });

  it("shrinks when dragging left below midpoint", () => {
    const preview = computeResizePreview({
      col: 0,
      clientX: 230,
      gridRect: rect,
      gapPx: 8,
      adjacentWidget: null,
    });
    expect(preview?.commitWide).toBe(false);
    expect(preview?.previewWidth).toBeLessThan(160);
  });
});
