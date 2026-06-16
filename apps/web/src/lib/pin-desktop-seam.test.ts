import { describe, expect, it } from "vitest";
import { normalizeLayout } from "./pin-desktop.js";
import {
  applySeamResizeCommit,
  buildPinSeams,
  computeSeamResizePreview,
  defaultSeamBoundaryX,
  isSeamVisuallyPlaced,
  resolveSeamBoundaryX,
  resolveSeamPointerX,
  seamAffectsWidget,
  seamForWidgetLeftEdge,
  seamForWidgetRightEdge,
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
      cols: ["chat", null, "kanban"],
      wide: [true, false, false],
    });
    const seam = buildPinSeams(layout)[0];
    expect(seam).toMatchObject({
      boundary: 1,
      leftWidget: "chat",
      rightWidget: "kanban",
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
      cols: ["chat", null, "kanban"],
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
      cols: ["chat", null, "kanban"],
      wide: [true, false, false],
    });
    const seam = buildPinSeams(layout)[0];
    const narrow = computeSeamResizePreview({ seam, clientX: 220, gridRect: rect, gapPx: 8 });
    expect(narrow?.commitLeftWide).toBe(false);
    const wideDefault = defaultSeamBoundaryX(seam, layout, rect, 8);
    expect(wideDefault).toBeCloseTo(297.3, 0);
  });

  it("commits wide on left column after seam crosses midpoint", () => {
    const layout = normalizeLayout({
      cols: ["chat", "tasks", "kanban"],
      wide: [false, false, false],
    });
    const seam = buildPinSeams(layout)[0];
    const next = applySeamResizeCommit(layout, seam, true);
    expect(next.cols).toEqual(["chat", null, "kanban"]);
    expect(next.wide[0]).toBe(true);
  });

  it("finds seam when only third column is pinned beside empty middle", () => {
    const layout = normalizeLayout({
      cols: [null, null, "kanban"],
      wide: [false, false, false],
    });
    const seam = buildPinSeams(layout)[0];
    expect(seam).toMatchObject({
      boundary: 1,
      leftWidget: "kanban",
      pairRightCol: 2,
      rightWidget: null,
    });
  });

  it("expands third column card into empty middle slot", () => {
    const layout = normalizeLayout({
      cols: [null, null, "kanban"],
      wide: [false, false, false],
    });
    const seam = buildPinSeams(layout)[0];
    const next = applySeamResizeCommit(layout, seam, true);
    expect(next.cols).toEqual([null, "kanban", null]);
    expect(next.wide[1]).toBe(true);
  });

  it("centers seam on visual gap between adjacent card rects", () => {
    const seam = {
      boundary: 1 as const,
      leftCol: 1,
      leftWidget: "tasks" as const,
      pairRightCol: 2,
      rightWidget: "kanban" as const,
      dual: true,
    };
    const layout = normalizeLayout({
      cols: ["chat", "tasks", "kanban"],
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
    expect(seamForWidgetRightEdge(layout, "detail")).toEqual(seam);
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
    expect(seamForWidgetRightEdge(layout, "tasks")).toEqual(seam);
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
  });

  it("hides dual seam when right widget is already wide", () => {
    const layout = normalizeLayout({
      cols: ["detail", "tasks", null],
      wide: [false, true, false],
    });
    const seam = buildPinSeams(layout).find((s) => s.boundary === 0)!;
    expect(
      isSeamVisuallyPlaced(
        seam,
        layout,
        { left: 100, right: 380, top: 0, bottom: 400 } as DOMRect,
        { left: 390, right: 900, top: 0, bottom: 400 } as DOMRect,
      ),
    ).toBe(false);
  });

  it("maps wide card left edge to neighbor dual seam when present", () => {
    const layout = normalizeLayout({
      cols: ["detail", "tasks", null],
      wide: [false, true, false],
    });
    const dualSeam = buildPinSeams(layout).find((s) => s.boundary === 0)!;
    expect(seamForWidgetLeftEdge(layout, "tasks")).toEqual(dualSeam);
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
      edge: "right",
      actingWidget: "detail",
    })!;
    expect(expandLeft.leftWidth).toBeGreaterThan(atRest.leftWidth);
    expect(expandLeft.rightWidth).toBeLessThan(atRest.rightWidth);
    expect(expandLeft.consumeRight).toBe(false);
  });

  it("mirrors wide right card left-edge drag so moving left shrinks", () => {
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
      edge: "left",
      actingWidget: "tasks",
    })!;
    expect(dragLeft.rightWidth).toBeLessThan(atRest.rightWidth);
    expect(dragLeft.leftWidth).toBeGreaterThan(atRest.leftWidth);
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
    expect(seamForWidgetLeftEdge(layout, "tasks")).toEqual(seam);
    expect(seamForWidgetRightEdge(layout, "detail")).toEqual(seam);
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
      edge: "right",
      actingWidget: "detail",
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
      edge: "right",
      actingWidget: "detail",
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
    expect(next.cols).toEqual(["detail", null, null]);
    expect(next.wide).toEqual([true, false, false]);
  });

  it("commits reverse squeeze to wide-right narrow-left", () => {
    const layout = normalizeLayout({
      cols: ["detail", null, "tasks"],
      wide: [true, false, false],
    });
    const seam = buildPinSeams(layout)[0];
    const preview = computeSeamResizePreview({
      seam,
      clientX: 220,
      gridRect: rect,
      gapPx: 8,
      layout,
    })!;
    expect(preview.commitLeftWide).toBe(false);
    const next = applySeamResizeCommit(layout, seam, preview);
    expect(next.cols).toEqual(["detail", "tasks", null]);
    expect(next.wide).toEqual([false, true, false]);
  });

  it("mirrors right-widget right-edge drag so moving right expands", () => {
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
      edge: "right",
      actingWidget: "tasks",
    })!;
    expect(dragRight.rightWidth).toBeGreaterThan(atRest.rightWidth);
  });

  it("mirrors wide-card left-edge drag so moving right shrinks", () => {
    const layout = normalizeLayout({
      cols: ["detail", null, null],
      wide: [true, false, false],
    });
    const seam = buildPinSeams(layout)[0];
    const atWide = computeSeamResizePreview({
      seam,
      clientX: 297,
      gridRect: rect,
      gapPx: 8,
      layout,
      edge: "right",
      actingWidget: "detail",
    })!;
    expect(atWide.commitLeftWide).toBe(true);
    const dragLeftEdgeRight = computeSeamResizePreview({
      seam,
      clientX: 220,
      gridRect: rect,
      gapPx: 8,
      layout,
      edge: "left",
      actingWidget: "detail",
    })!;
    expect(dragLeftEdgeRight.commitLeftWide).toBe(false);
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
