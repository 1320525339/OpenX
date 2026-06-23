import { describe, expect, it } from "vitest";
import { columnFromPointer } from "./pin-desktop-drag.js";

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
});
