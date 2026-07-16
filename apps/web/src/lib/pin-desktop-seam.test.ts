import { describe, expect, it } from "vitest";
import { normalizeLayout, setPinSpan, setWidgetSpan, columnSpan, extensionSlotColumn } from "./pin-desktop.js";
import {
  applySeamResizeCommit,
  buildPinSeams,
  computeSeamResizePreview,
  defaultSeamBoundaryX,
  isSeamVisuallyPlaced,
  resolveSeamBoundaryX,
  resolveSeamPointerX,
  seamAffectsWidget,
  seamLineLeftPx,
} from "./pin-desktop-seam.js";

describe("pin-desktop-seam", () => {
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

  it("finds dual seam between two adjacent cards", () => {
    const layout = normalizeLayout({
      cols: ["chat", "tasks", null],
      wide: [false, false, false],
    });
    const seams = buildPinSeams(layout);
    expect(seams.length).toBeGreaterThanOrEqual(1);
    expect(seams[0]).toMatchObject({
      boundary: 0,
      leftWidget: "chat",
      rightWidget: "tasks",
      dual: true,
      pairRightCol: 1,
    });
  });

  it("finds dual seam between wide-left and third-column card", () => {
    const layout = normalizeLayout({
      cols: ["chat", null, "evidence"],
      wide: [true, false, false],
    });
    const seam = buildPinSeams(layout)[0];
    expect(seam).toMatchObject({
      boundary: 1,
      leftWidget: "chat",
      rightWidget: "evidence",
      pairRightCol: 2,
      dual: true,
    });
  });

  it("dual seam keeps pair total while resizing", () => {
    const seam = {
      boundary: 0 as const,
      leftCol: 0,
      leftWidget: "chat" as const,
      pairRightCol: 1,
      rightWidget: "tasks" as const,
      dual: true,
    };
    const narrow = computeSeamResizePreview({ seam, clientX: 220, gridRect: rect, gapPx: 8 });
    expect(narrow?.leftWidth).toBeCloseTo(120, 0);
    expect(narrow?.rightWidth).toBeCloseTo(77.3, 0);
    expect(narrow?.leftWidth! + narrow!.rightWidth!).toBeCloseTo(narrow!.pairTotal, 0);
    expect(narrow?.consumeRight).toBe(false);

    const wide = computeSeamResizePreview({ seam, clientX: 260, gridRect: rect, gapPx: 8 });
    expect(wide?.commitLeftWide).toBe(true);
    expect(wide?.consumeRight).toBe(true);

    const full = computeSeamResizePreview({ seam, clientX: 320, gridRect: rect, gapPx: 8 });
    expect(full?.leftWidth).toBeCloseTo(197.3, 0);
    expect(full?.rightWidth).toBeCloseTo(0, 0);
    expect(full?.commitLeftWide).toBe(true);
  });

  it("single card expands into empty neighbor column", () => {
    const layout = normalizeLayout({
      cols: ["chat", null, "evidence"],
      wide: [false, false, false],
    });
    const seam = buildPinSeams(layout)[0];
    const mid = computeSeamResizePreview({ seam, clientX: 250, gridRect: rect, gapPx: 8 });
    expect(mid?.commitLeftWide).toBe(false);
    const wide = computeSeamResizePreview({ seam, clientX: 270, gridRect: rect, gapPx: 8 });
    expect(wide?.commitLeftWide).toBe(true);
    expect(wide?.leftWidth).toBeCloseTo(170, 0);
  });

  it("wide card shrinks before third column snap", () => {
    const layout = normalizeLayout({
      cols: ["chat", null, "evidence"],
      wide: [true, false, false],
    });
    const seam = buildPinSeams(layout)[0];
    const narrow = computeSeamResizePreview({ seam, clientX: 220, gridRect: rect, gapPx: 8 });
    expect(narrow?.commitLeftWide).toBe(false);
    const wideDefault = defaultSeamBoundaryX(seam, layout, rect, 8);
    expect(wideDefault).toBeCloseTo(297.3, 0);
  });

  it("expands left card on boundary-0 and pushes neighbor to third column", () => {
    const layout = normalizeLayout({
      cols: ["chat", "tasks", null],
      wide: [false, false, false],
    });
    const seam = buildPinSeams(layout)[0];
    const next = applySeamResizeCommit(layout, seam, true);
    expect(next.cols).toEqual(["chat", null, "tasks"]);
    expect(next.wide[0]).toBe(true);
    expect(next.wide[1]).toBe(false);
  });

  it("finds seam when only third column is pinned beside empty middle", () => {
    const layout = normalizeLayout({
      cols: [null, null, "evidence"],
      wide: [false, false, false],
    });
    const seam = buildPinSeams(layout)[0];
    expect(seam).toMatchObject({
      boundary: 1,
      leftWidget: "evidence",
      pairRightCol: 2,
      rightWidget: null,
    });
  });

  it("expands third column card into empty middle slot", () => {
    const layout = normalizeLayout({
      cols: [null, null, "evidence"],
      wide: [false, false, false],
    });
    const seam = buildPinSeams(layout)[0];
    const next = applySeamResizeCommit(layout, seam, true);
    expect(next.cols).toEqual([null, "evidence", null]);
    expect(next.wide[1]).toBe(true);
  });

  it("centers seam on visual gap between adjacent card rects", () => {
    const seam = {
      boundary: 1 as const,
      leftCol: 1,
      leftWidget: "tasks" as const,
      pairRightCol: 2,
      rightWidget: "evidence" as const,
      dual: true,
    };
    const layout = normalizeLayout({
      cols: ["chat", "tasks", "evidence"],
      wide: [false, false, false],
    });
    const gridRect = {
      left: 0,
      width: 900,
      top: 0,
      height: 400,
      right: 900,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
    expect(
      seamLineLeftPx({
        seam,
        layout,
        gridRect,
        leftCell: { left: 280, right: 580, top: 0, bottom: 400 } as DOMRect,
        rightCell: { left: 600, right: 880, top: 0, bottom: 400 } as DOMRect,
      }),
    ).toBe(590);
  });

  it("allows right card to expand left past midpoint", () => {
    const seam = {
      boundary: 0 as const,
      leftCol: 0,
      leftWidget: "chat" as const,
      pairRightCol: 1,
      rightWidget: "tasks" as const,
      dual: true,
    };
    const expandRight = computeSeamResizePreview({
      seam,
      clientX: 140,
      gridRect: rect,
      gapPx: 8,
    });
    expect(expandRight?.commitRightWide).toBe(true);
    expect(expandRight?.consumeLeft).toBe(true);
    expect(expandRight?.rightWidth).toBeGreaterThan(expandRight!.oneWidth);
  });

  it("commits right wide when dragging seam left past left midpoint", () => {
    const layout = normalizeLayout({
      cols: ["chat", "tasks", null],
      wide: [false, false, false],
    });
    const seam = buildPinSeams(layout)[0];
    const preview = computeSeamResizePreview({
      seam,
      clientX: 140,
      gridRect: rect,
      gapPx: 8,
    })!;
    const next = applySeamResizeCommit(layout, seam, preview);
    expect(next.cols).toEqual(["tasks", null, null]);
    expect(next.wide[0]).toBe(true);
  });

  it("shows seam on right card when empty column sits between cards", () => {
    const layout = normalizeLayout({
      cols: ["chat", null, "tasks"],
      wide: [false, false, false],
    });
    const seam = buildPinSeams(layout).find((s) => s.leftWidget === "tasks")!;
    expect(
      isSeamVisuallyPlaced(
        seam,
        layout,
        { left: 100, right: 200, top: 0, bottom: 400 } as DOMRect,
        { left: 400, right: 500, top: 0, bottom: 400 } as DOMRect,
      ),
    ).toBe(true);
    expect(
      resolveSeamBoundaryX({
        seam,
        layout,
        gridRect: rect,
        leftCell: { left: 100, right: 200, top: 0, bottom: 400 } as DOMRect,
        rightCell: { left: 400, right: 500, top: 0, bottom: 400 } as DOMRect,
      }),
    ).toBe(396);
  });

  it("shows shrink seam on lone wide card right edge", () => {
    const layout = normalizeLayout({
      cols: ["detail", null, null],
      wide: [true, false, false],
    });
    const seam = buildPinSeams(layout)[0];
    expect(seam.boundary).toBe(1);
    expect(
      isSeamVisuallyPlaced(
        seam,
        layout,
        { left: 100, right: 700, top: 0, bottom: 400 } as DOMRect,
        null,
      ),
    ).toBe(true);
  });

  it("shrinks lone wide card back to one column", () => {
    const layout = normalizeLayout({
      cols: ["detail", null, null],
      wide: [true, false, false],
    });
    const seam = buildPinSeams(layout)[0];
    const preview = computeSeamResizePreview({
      seam,
      clientX: 200,
      gridRect: rect,
      gapPx: 8,
    })!;
    expect(preview.commitLeftWide).toBe(false);
    const next = applySeamResizeCommit(layout, seam, preview);
    expect(next.wide[0]).toBe(false);
    expect(next.cols).toEqual(["detail", null, null]);
  });

  it("shows right expand seam for middle column into empty slot", () => {
    const layout = normalizeLayout({
      cols: ["chat", "tasks", null],
      wide: [false, false, false],
    });
    const seam = buildPinSeams(layout).find((s) => s.leftWidget === "tasks")!;
    expect(seam.boundary).toBe(1);
    expect(
      isSeamVisuallyPlaced(
        seam,
        layout,
        { left: 386, right: 756, top: 0, bottom: 400 } as DOMRect,
        null,
      ),
    ).toBe(true);
  });

  it("expands middle column into empty right slot", () => {
    const layout = normalizeLayout({
      cols: ["chat", "tasks", null],
      wide: [false, false, false],
    });
    const seam = buildPinSeams(layout).find((s) => s.leftWidget === "tasks")!;
    const preview = computeSeamResizePreview({
      seam,
      clientX: 360,
      gridRect: rect,
      gapPx: 8,
    })!;
    expect(preview.commitLeftWide).toBe(true);
    const next = applySeamResizeCommit(layout, seam, preview);
    expect(next.cols).toEqual(["chat", "tasks", null]);
    expect(next.wide[1]).toBe(true);
    expect(extensionSlotColumn(next)).toBe(null);
  });

  it("expands third-column card into middle wide without leaving extension slot", () => {
    const layout = normalizeLayout({
      cols: ["chat", null, "tasks"],
      wide: [false, false, false],
    });
    const seam = buildPinSeams(layout).find((s) => s.leftWidget === "tasks")!;
    const preview = computeSeamResizePreview({
      seam,
      clientX: 360,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    expect(preview.commitLeftWide).toBe(true);
    const next = applySeamResizeCommit(layout, seam, preview);
    expect(next.cols).toEqual(["chat", "tasks", null]);
    expect(next.wide).toEqual([false, true, false]);
    expect(extensionSlotColumn(next)).toBe(null);
  });

  it("expands left card via boundary-0 when third column is empty", () => {
    const layout = normalizeLayout({
      cols: ["chat", "tasks", null],
      wide: [false, false, false],
    });
    const seam = buildPinSeams(layout).find((s) => s.boundary === 0)!;
    const preview = computeSeamResizePreview({
      seam,
      clientX: 260,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    expect(preview.commitSpan).toBe(2);
    const next = applySeamResizeCommit(layout, seam, preview);
    expect(next.cols).toEqual(["chat", null, "tasks"]);
    expect(next.wide).toEqual([true, false, false]);
    expect(extensionSlotColumn(next)).toBe(null);
  });

  it("uses the release tier after the pointer returns from a wider preview", () => {
    const layout = normalizeLayout({
      cols: ["chat", "tasks", null],
      wide: [false, false, false],
    });
    const seam = buildPinSeams(layout).find((s) => s.leftWidget === "tasks")!;
    const maxPreview = computeSeamResizePreview({
      seam,
      clientX: 360,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    const releasePreview = computeSeamResizePreview({
      seam,
      clientX: 300,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    expect(maxPreview.commitLeftWide).toBe(true);
    expect(releasePreview.commitLeftWide).toBe(false);
    const next = applySeamResizeCommit(layout, seam, releasePreview);
    expect(next.wide[1]).toBe(false);
    expect(extensionSlotColumn(next)).toBe(2);
  });

  it("uses the release tier after the pointer returns from a narrower preview", () => {
    const layout = normalizeLayout({
      cols: ["chat", null, null],
      wide: [true, false, true],
    });
    const seam = buildPinSeams(layout)[0]!;
    const minPreview = computeSeamResizePreview({
      seam,
      clientX: 300,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    const releasePreview = computeSeamResizePreview({
      seam,
      clientX: 390,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    expect(minPreview.commitSpan).toBe(2);
    expect(releasePreview.commitSpan).toBe(3);
    const next = applySeamResizeCommit(layout, seam, releasePreview);
    expect(columnSpan(next, 0)).toBe(3);
    expect(next.wide).toEqual([true, false, true]);
  });

  it("shrinks lone span-3 chat back to single column", () => {
    const layout = normalizeLayout({
      cols: ["chat", null, null],
      wide: [true, false, true],
    });
    const seam = buildPinSeams(layout)[0]!;
    const preview = computeSeamResizePreview({
      seam,
      clientX: 220,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    expect(preview.commitSpan).toBe(1);
    const next = applySeamResizeCommit(layout, seam, preview);
    expect(next.cols).toEqual(["chat", null, null]);
    expect(next.wide).toEqual([false, false, false]);
    expect(columnSpan(next, 0)).toBe(1);
    expect(extensionSlotColumn(next)).toBe(1);
  });

  it("shows shrink seam for lone span-3 card", () => {
    const layout = normalizeLayout({
      cols: ["chat", null, null],
      wide: [true, false, true],
    });
    const seam = buildPinSeams(layout)[0]!;
    expect(
      isSeamVisuallyPlaced(
        seam,
        layout,
        { left: 100, right: 700, top: 0, bottom: 400 } as DOMRect,
        null,
      ),
    ).toBe(true);
  });

  it("shrinks 112 wide-left into two single cards by moving the right neighbor", () => {
    const layout = normalizeLayout({
      cols: ["chat", null, "tasks"],
      wide: [true, false, false],
    });
    const seam = buildPinSeams(layout)[0]!;
    const preview = computeSeamResizePreview({
      seam,
      clientX: 195,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    expect(preview.commitSpan).toBe(1);
    const next = applySeamResizeCommit(layout, seam, preview);
    expect(next.cols).toEqual(["chat", "tasks", null]);
    expect(next.wide).toEqual([false, false, false]);
  });

  it("commits chat expand from 1,2,2 layout to wide-left single-right", () => {
    const layout = normalizeLayout({
      cols: ["chat", "tasks", null],
      wide: [false, true, false],
    });
    const seam = buildPinSeams(layout).find((s) => s.boundary === 0)!;
    const preview = computeSeamResizePreview({
      seam,
      clientX: 260,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    expect(preview.commitSpan).toBe(2);
    const next = applySeamResizeCommit(layout, seam, preview);
    expect(next.cols).toEqual(["chat", null, "tasks"]);
    expect(next.wide).toEqual([true, false, false]);
  });

  it("shows boundary-0 squeeze seam when right widget is already wide", () => {
    const layout = normalizeLayout({
      cols: ["detail", "tasks", null],
      wide: [false, true, false],
    });
    const seam = buildPinSeams(layout).find((s) => s.boundary === 0)!;
    expect(
      isSeamVisuallyPlaced(
        seam,
        layout,
        { left: 100, right: 180, top: 0, bottom: 400 } as DOMRect,
        { left: 188, right: 900, top: 0, bottom: 400 } as DOMRect,
      ),
    ).toBe(true);
  });

  it("squeezes wide right card when left neighbor expands", () => {
    const layout = normalizeLayout({
      cols: ["detail", "tasks", null],
      wide: [false, true, false],
    });
    const seam = buildPinSeams(layout).find((s) => s.boundary === 0)!;
    const atRest = computeSeamResizePreview({
      seam,
      clientX: 210,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    const expandLeft = computeSeamResizePreview({
      seam,
      clientX: 250,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    expect(expandLeft.leftWidth).toBeGreaterThan(atRest.leftWidth);
    expect(expandLeft.rightWidth).toBeLessThan(atRest.rightWidth);
    expect(expandLeft.consumeRight).toBe(false);
  });

  it("shrinks wide-right card when seam moves left past midpoint", () => {
    const layout = normalizeLayout({
      cols: ["detail", "tasks", null],
      wide: [false, true, false],
    });
    const seam = buildPinSeams(layout).find((s) => s.boundary === 0)!;
    const atRest = computeSeamResizePreview({
      seam,
      clientX: 210,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    const dragLeft = computeSeamResizePreview({
      seam,
      clientX: 170,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    expect(dragLeft.rightWidth).toBeGreaterThan(atRest.rightWidth);
    expect(dragLeft.leftWidth).toBeLessThan(atRest.leftWidth);
  });

  it("commits squeeze from narrow-left wide-right to wide-left narrow-right", () => {
    const layout = normalizeLayout({
      cols: ["detail", "tasks", null],
      wide: [false, true, false],
    });
    const seam = buildPinSeams(layout).find((s) => s.boundary === 0)!;
    const preview = computeSeamResizePreview({
      seam,
      clientX: 260,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    expect(preview.commitLeftWide).toBe(true);
    const next = applySeamResizeCommit(layout, seam, preview);
    expect(next.cols).toEqual(["detail", null, "tasks"]);
    expect(next.wide).toEqual([true, false, false]);
  });

  it("finds dual seam between wide-left and narrow-right at col2", () => {
    const layout = normalizeLayout({
      cols: ["detail", null, "tasks"],
      wide: [true, false, false],
    });
    const seam = buildPinSeams(layout)[0];
    expect(seam).toMatchObject({
      boundary: 1,
      leftWidget: "detail",
      rightWidget: "tasks",
      pairRightCol: 2,
      dual: true,
    });
  });

  it("expands right card when wide-left shrinks from right edge", () => {
    const layout = normalizeLayout({
      cols: ["detail", null, "tasks"],
      wide: [true, false, false],
    });
    const seam = buildPinSeams(layout)[0];
    const atRest = computeSeamResizePreview({
      seam,
      clientX: 305,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    const shrinkLeft = computeSeamResizePreview({
      seam,
      clientX: 250,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    expect(shrinkLeft.leftWidth).toBeLessThan(atRest.leftWidth);
    expect(shrinkLeft.rightWidth).toBeGreaterThan(atRest.rightWidth);
    expect(seamAffectsWidget(seam, "tasks")).toBe("right");
  });

  it("pushes wide-left into right column when squeezing left to right", () => {
    const layout = normalizeLayout({
      cols: ["detail", null, "tasks"],
      wide: [true, false, false],
    });
    const seam = buildPinSeams(layout)[0];
    const atRest = computeSeamResizePreview({
      seam,
      clientX: 305,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    const squeezeRight = computeSeamResizePreview({
      seam,
      clientX: 360,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    expect(squeezeRight.boundaryX).toBeGreaterThan(atRest.boundaryX);
    expect(squeezeRight.leftWidth).toBeGreaterThan(atRest.leftWidth);
    expect(squeezeRight.rightWidth).toBeLessThan(atRest.rightWidth);
  });

  it("consumes right card when wide-left pushes through third column", () => {
    const layout = normalizeLayout({
      cols: ["detail", null, "tasks"],
      wide: [true, false, false],
    });
    const seam = buildPinSeams(layout)[0];
    const preview = computeSeamResizePreview({
      seam,
      clientX: 400,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    expect(preview.consumeRight).toBe(true);
    const next = applySeamResizeCommit(layout, seam, preview);
    expect(next.cols).toEqual(["detail", null, "tasks"]);
    expect(next.wide).toEqual([true, false, true]);
  });

  it("commits span-3 when wide-left crosses full width with third column card", () => {
    const layout = normalizeLayout({
      cols: ["detail", null, "tasks"],
      wide: [true, false, false],
    });
    const seam = buildPinSeams(layout)[0];
    const preview = computeSeamResizePreview({
      seam,
      clientX: 400,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    expect(preview.commitLeftWide).toBe(true);
    const next = applySeamResizeCommit(layout, seam, preview);
    expect(next.cols).toEqual(["detail", null, "tasks"]);
    expect(next.wide).toEqual([true, false, true]);
  });

  it("shrinks span-3 to span-2 and restores third-column card", () => {
    let layout = normalizeLayout({
      cols: ["chat", null, "detail"],
      wide: [true, false, false],
    });
    layout = setPinSpan(layout, 0, 3);
    expect(layout.cols).toEqual(["chat", null, "detail"]);
    expect(layout.wide).toEqual([true, false, true]);

    const seam = buildPinSeams(layout)[0]!;
    const preview = computeSeamResizePreview({
      seam,
      clientX: 300,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    expect(preview.commitSpan).toBe(2);
    const next = applySeamResizeCommit(layout, seam, preview);
    expect(next.wide).toEqual([true, false, false]);
    expect(next.cols).toEqual(["chat", null, "detail"]);
  });

  it("shrinks third-column-only card from span-2 back to column 3", () => {
    let layout = normalizeLayout({
      cols: [null, null, "evidence"],
      wide: [false, false, false],
    });
    const expandSeam = buildPinSeams(layout)[0]!;
    layout = applySeamResizeCommit(layout, expandSeam, true);
    expect(layout.cols).toEqual([null, "evidence", null]);
    expect(layout.wide).toEqual([false, true, false]);

    const shrinkSeam = buildPinSeams(layout)[0]!;
    const shrinkPreview = computeSeamResizePreview({
      seam: shrinkSeam,
      clientX: 140,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    const shrunk = applySeamResizeCommit(layout, shrinkSeam, shrinkPreview);
    expect(shrunk.cols).toEqual([null, "evidence", null]);
    expect(shrunk.wide).toEqual([false, false, false]);
  });

  it("shrinks 010 wide middle back to single column without jumping to col3", () => {
    const layout = normalizeLayout({
      cols: [null, "tasks", null],
      wide: [false, true, false],
    });
    const seam = buildPinSeams(layout)[0]!;
    const preview = computeSeamResizePreview({
      seam,
      clientX: 220,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    expect(preview.commitLeftWide).toBe(false);
    const next = applySeamResizeCommit(layout, seam, preview);
    expect(next.cols).toEqual([null, "tasks", null]);
    expect(next.wide).toEqual([false, false, false]);
    expect(extensionSlotColumn(next)).toBe(0);
  });

  it("shrinks 110 wide middle back to chat and tasks side by side", () => {
    const layout = normalizeLayout({
      cols: ["chat", "tasks", null],
      wide: [false, true, false],
    });
    const seam = buildPinSeams(layout).find((s) => s.leftWidget === "tasks")!;
    const preview = computeSeamResizePreview({
      seam,
      clientX: 220,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    const next = applySeamResizeCommit(layout, seam, preview);
    expect(next.cols).toEqual(["chat", "tasks", null]);
    expect(next.wide).toEqual([false, false, false]);
  });

  it("commits span-3 at third tier snap", () => {
    const layout = normalizeLayout({
      cols: ["detail", null, "tasks"],
      wide: [true, false, false],
    });
    const seam = buildPinSeams(layout)[0];
    const preview = computeSeamResizePreview({
      seam,
      clientX: 360,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    expect(preview.commitSpan).toBe(3);
    expect(preview.consumeRight).toBe(true);
    const next = applySeamResizeCommit(layout, seam, preview);
    expect(next.cols).toEqual(["detail", null, "tasks"]);
    expect(next.wide).toEqual([true, false, true]);
  });

  it("commits span-3 for wide-left with empty third column at third tier", () => {
    const layout = normalizeLayout({
      cols: ["detail", null, null],
      wide: [true, false, false],
    });
    const seam = buildPinSeams(layout)[0];
    const preview = computeSeamResizePreview({
      seam,
      clientX: 370,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    expect(preview.commitSpan).toBe(3);
    const next = applySeamResizeCommit(layout, seam, preview);
    expect(next.wide).toEqual([true, false, true]);
  });

  it("keeps wide-left layout when seam release stays on same span tier", () => {
    const layout = normalizeLayout({
      cols: ["detail", null, "tasks"],
      wide: [true, false, false],
    });
    const seam = buildPinSeams(layout)[0];
    const preview = computeSeamResizePreview({
      seam,
      clientX: 300,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    expect(preview.commitSpan).toBe(2);
    const next = applySeamResizeCommit(layout, seam, preview);
    expect(next.cols).toEqual(["detail", null, "tasks"]);
    expect(next.wide).toEqual([true, false, false]);
  });

  it("shrinks 112 wide-left with third-column card into two single cards", () => {
    const layout = normalizeLayout({
      cols: ["detail", null, "tasks"],
      wide: [true, false, false],
    });
    const seam = buildPinSeams(layout)[0];
    const preview = computeSeamResizePreview({
      seam,
      clientX: 195,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    expect(preview.commitSpan).toBe(1);
    const next = applySeamResizeCommit(layout, seam, preview);
    expect(next.cols).toEqual(["detail", "tasks", null]);
    expect(next.wide).toEqual([false, false, false]);
  });

  it("expands first column progressively from span-1 through span-3", () => {
    const start = normalizeLayout({
      cols: ["evidence", null, null],
      wide: [false, false, false],
    });
    const seam1 = buildPinSeams(start)[0]!;
    expect(seam1.boundary).toBe(0);

    const to2Preview = computeSeamResizePreview({
      seam: seam1,
      clientX: 280,
      gridRect: rect,
      gapPx: 8,
      layout: start,
    })!;
    expect(to2Preview.commitSpan).toBe(2);
    let layout = applySeamResizeCommit(start, seam1, to2Preview);
    expect(columnSpan(layout, 0)).toBe(2);
    expect(layout.cols).toEqual(["evidence", null, null]);

    const seam2 = buildPinSeams(layout)[0]!;
    expect(seam2.boundary).toBe(1);
    const to3Preview = computeSeamResizePreview({
      seam: seam2,
      clientX: 380,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    expect(to3Preview.commitSpan).toBe(3);
    layout = applySeamResizeCommit(layout, seam2, to3Preview);
    expect(columnSpan(layout, 0)).toBe(3);
    expect(layout.wide).toEqual([true, false, true]);
  });

  it("expands single column card to wide then shrinks back", () => {
    const start = normalizeLayout({
      cols: ["chat", null, "detail"],
      wide: [false, false, false],
    });
    const expandSeam = buildPinSeams(start).find((s) => s.boundary === 0)!;
    const expanded = applySeamResizeCommit(start, expandSeam, true);
    expect(expanded.wide).toEqual([true, false, false]);
    expect(expanded.cols).toEqual(["chat", null, "detail"]);

    const shrinkSeam = buildPinSeams(expanded)[0]!;
    const shrinkPreview = computeSeamResizePreview({
      seam: shrinkSeam,
      clientX: 195,
      gridRect: rect,
      gapPx: 8,
      layout: expanded,
    })!;
    const shrunk = applySeamResizeCommit(expanded, shrinkSeam, shrinkPreview);
    expect(shrunk.wide).toEqual([false, false, false]);
    expect(shrunk.cols).toEqual(["chat", "detail", null]);
  });

  it("shrinks span-3 back to span-2 at second tier", () => {
    const layout = normalizeLayout({
      cols: ["detail", null, null],
      wide: [true, false, true],
    });
    const seam = buildPinSeams(layout)[0]!;
    const preview = computeSeamResizePreview({
      seam,
      clientX: 300,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    expect(preview.commitSpan).toBe(2);
    const next = applySeamResizeCommit(layout, seam, preview);
    expect(next.cols).toEqual(["detail", null, null]);
    expect(next.wide).toEqual([true, false, false]);
  });

  it("progresses span-3 through span-2 to span-1", () => {
    let layout = normalizeLayout({
      cols: ["chat", null, null],
      wide: [true, false, true],
    });
    const seam3 = buildPinSeams(layout)[0]!;
    layout = applySeamResizeCommit(
      layout,
      seam3,
      computeSeamResizePreview({
        seam: seam3,
        clientX: 300,
        gridRect: rect,
        gapPx: 8,
        layout,
      })!,
    );
    expect(columnSpan(layout, 0)).toBe(2);

    const seam2 = buildPinSeams(layout)[0]!;
    const commitPreview = computeSeamResizePreview({
      seam: seam2,
      clientX: 220,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    expect(commitPreview.commitSpan).toBe(1);
    layout = applySeamResizeCommit(layout, seam2, commitPreview);
    expect(columnSpan(layout, 0)).toBe(1);
    expect(layout.wide).toEqual([false, false, false]);
  });

  it("expands right card when seam moves right past midpoint", () => {
    const layout = normalizeLayout({
      cols: ["chat", "tasks", null],
      wide: [false, false, false],
    });
    const seam = buildPinSeams(layout).find((s) => s.boundary === 0)!;
    const atRest = computeSeamResizePreview({
      seam,
      clientX: 210,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    const dragRight = computeSeamResizePreview({
      seam,
      clientX: 250,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    expect(dragRight.leftWidth).toBeGreaterThan(atRest.leftWidth);
    expect(dragRight.rightWidth).toBeLessThan(atRest.rightWidth);
  });

  it("snaps wide card seam drag to span tiers", () => {
    const layout = normalizeLayout({
      cols: ["detail", null, null],
      wide: [true, false, false],
    });
    const seam = buildPinSeams(layout)[0];
    const span2 = computeSeamResizePreview({
      seam,
      clientX: 300,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    expect(span2.commitSpan).toBe(2);
    const span1 = computeSeamResizePreview({
      seam,
      clientX: 220,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    expect(span1.commitSpan).toBe(1);
  });

  it("middle column alone can expand to full width span-3", () => {
    const layout = normalizeLayout({
      cols: [null, "tasks", null],
      wide: [false, false, false],
    });
    const next = setWidgetSpan(layout, "tasks", 3);
    expect(next.cols).toEqual(["tasks", null, null]);
    expect(next.wide).toEqual([true, false, true]);
    expect(columnSpan(next, 0)).toBe(3);
  });

  it("middle column alone expands to span-2 via seam drag", () => {
    const layout = normalizeLayout({
      cols: [null, "tasks", null],
      wide: [false, false, false],
    });
    const seam = buildPinSeams(layout).find((s) => s.leftWidget === "tasks")!;
    const preview = computeSeamResizePreview({
      seam,
      clientX: 360,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    expect(preview.commitSpan).toBe(2);
    const next = applySeamResizeCommit(layout, seam, preview);
    expect(next.cols).toEqual([null, "tasks", null]);
    expect(next.wide).toEqual([false, true, false]);
    expect(columnSpan(next, 1)).toBe(2);
  });

  it("third column card can expand to full width span-3", () => {
    const layout = normalizeLayout({
      cols: [null, null, "evidence"],
      wide: [false, false, false],
    });
    const next = setWidgetSpan(layout, "evidence", 3);
    expect(next.cols).toEqual(["evidence", null, null]);
    expect(columnSpan(next, 0)).toBe(3);
  });

  it("lone third column expands to span-2 via seam drag left", () => {
    const layout = normalizeLayout({
      cols: [null, null, "tasks"],
      wide: [false, false, false],
    });
    const seam = buildPinSeams(layout).find((s) => s.leftWidget === "tasks")!;
    const preview = computeSeamResizePreview({
      seam,
      clientX: 360,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    expect(preview.commitLeftWide).toBe(true);
    const next = applySeamResizeCommit(layout, seam, preview);
    expect(next.cols).toEqual([null, "tasks", null]);
    expect(next.wide).toEqual([false, true, false]);
    expect(columnSpan(next, 1)).toBe(2);
  });

  it("lone third column expands to span-3 via seam drag when left columns empty", () => {
    const layout = normalizeLayout({
      cols: [null, null, "tasks"],
      wide: [false, false, false],
    });
    const seam = buildPinSeams(layout).find((s) => s.leftWidget === "tasks")!;
    const preview = computeSeamResizePreview({
      seam,
      clientX: 130,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    expect(preview.commitLeftWide).toBe(true);
    const next = applySeamResizeCommit(layout, seam, preview);
    expect(next.cols).toEqual(["tasks", null, null]);
    expect(columnSpan(next, 0)).toBe(3);
  });

  it("shows tasks right expand seam when third column is empty", () => {
    const layout = normalizeLayout({
      cols: ["chat", "tasks", null],
      wide: [false, false, false],
    });
    const seam = buildPinSeams(layout).find((s) => s.boundary === 1)!;
    expect(seam.leftWidget).toBe("tasks");
    expect(
      isSeamVisuallyPlaced(
        seam,
        layout,
        { left: 400, right: 800, top: 0, bottom: 400 } as DOMRect,
        null,
      ),
    ).toBe(true);
  });
});
