import { describe, expect, it } from "vitest";
import { mapScreencastClick } from "./browser-screencast-click";

describe("mapScreencastClick", () => {
  it("maps center click to viewport coords", () => {
    const img = {
      getBoundingClientRect: () => ({
        left: 100,
        top: 50,
        width: 400,
        height: 225,
        right: 500,
        bottom: 275,
        x: 100,
        y: 50,
        toJSON: () => ({}),
      }),
    } as HTMLImageElement;

    const mapped = mapScreencastClick(img, 300, 162.5, 1280, 720);
    expect(mapped).toEqual({ x: 640, y: 360 });
  });

  it("maps click with letterbox (object-fit contain)", () => {
    const img = {
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 400,
        height: 400,
        right: 400,
        bottom: 400,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    } as HTMLImageElement;

    const mapped = mapScreencastClick(img, 200, 200, 1280, 720);
    expect(mapped).toEqual({ x: 640, y: 360 });
  });

  it("rejects clicks in letterbox margins", () => {
    const img = {
      getBoundingClientRect: () => ({
        left: 0,
        top: 0,
        width: 400,
        height: 400,
        right: 400,
        bottom: 400,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    } as HTMLImageElement;

    expect(mapScreencastClick(img, 200, 20, 1280, 720)).toBeNull();
  });
});
