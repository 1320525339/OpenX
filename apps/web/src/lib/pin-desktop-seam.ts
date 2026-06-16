import {
  emptyPinLayout,
  MAX_PIN_COLUMNS,
  normalizeLayout,
  setPinWide,
  type PinDesktopLayout,
  type PinWidgetId,
} from "./pin-desktop";
import { columnGeometry } from "./pin-desktop-drag";

/** 两列之间的可拖拽接缝（一条边联动左右两张卡） */
export type PinSeam = {
  boundary: 0 | 1;
  leftCol: number;
  leftWidget: PinWidgetId;
  /** 配对区域内的第二列（用于中线吸附） */
  pairRightCol: number;
  rightWidget: PinWidgetId | null;
  /** 配对区域内左↔右（卡或空位）此消彼长 */
  dual: boolean;
};

export type SeamResizePreview = {
  boundaryX: number;
  leftWidth: number;
  rightWidth: number;
  commitLeftWide: boolean;
  commitRightWide: boolean;
  consumeRight: boolean;
  consumeLeft: boolean;
  oneWidth: number;
  pairLeft: number;
  pairTotal: number;
  gapPx: number;
  snapLeft: number;
  snapRight: number;
};

/** 从布局解析可拉伸接缝 */
export function buildPinSeams(layout: PinDesktopLayout): PinSeam[] {
  const norm = normalizeLayout(layout);
  const seams: PinSeam[] = [];

  if (norm.cols[0] && !norm.wide[0]) {
    seams.push({
      boundary: 0,
      leftCol: 0,
      leftWidget: norm.cols[0],
      pairRightCol: 1,
      rightWidget: norm.cols[1],
      dual: true,
    });
  }

  if (norm.wide[0] && norm.cols[0]) {
    if (norm.cols[2] && !norm.cols[1]) {
      seams.push({
        boundary: 1,
        leftCol: 0,
        leftWidget: norm.cols[0],
        pairRightCol: 2,
        rightWidget: norm.cols[2],
        dual: true,
      });
    } else {
      seams.push({
        boundary: 1,
        leftCol: 0,
        leftWidget: norm.cols[0],
        pairRightCol: 1,
        rightWidget: null,
        dual: true,
      });
    }
  } else if (norm.cols[1] && norm.wide[1]) {
    seams.push({
      boundary: 1,
      leftCol: 1,
      leftWidget: norm.cols[1],
      pairRightCol: 2,
      rightWidget: null,
      dual: true,
    });
  } else if (norm.cols[1] && !norm.wide[1]) {
    seams.push({
      boundary: 1,
      leftCol: 1,
      leftWidget: norm.cols[1],
      pairRightCol: 2,
      rightWidget: norm.cols[2],
      dual: true,
    });
  } else if (
    norm.cols[2] &&
    !norm.wide[1] &&
    norm.cols[1] === null &&
    !norm.wide[0]
  ) {
    seams.push({
      boundary: 1,
      leftCol: 1,
      leftWidget: norm.cols[2],
      pairRightCol: 2,
      rightWidget: null,
      dual: true,
    });
  }

  return seams;
}

function widgetLogicalCol(layout: PinDesktopLayout, widget: PinWidgetId): number {
  const norm = normalizeLayout(layout);
  for (let col = 0; col < MAX_PIN_COLUMNS; col++) {
    if (norm.cols[col] === widget) return col;
    if (norm.split[col] && norm.splitBottom[col] === widget) return col;
  }
  return -1;
}

export function defaultSeamBoundaryX(
  seam: PinSeam,
  layout: PinDesktopLayout,
  gridRect: DOMRect,
  gapPx = 8,
): number {
  const { colWidth, colStart } = columnGeometry(gridRect, gapPx);
  const pairLeft = colStart(seam.leftCol);
  const oneWidth = colWidth;
  const pairTotal = colWidth * 2 + gapPx;
  const segments = buildPinSegmentsFromLayout(layout);
  const leftSeg = segments.find((s) => s.widget === seam.leftWidget);
  const leftStoredWide = leftSeg?.colspan === 2;
  const widgetCol = widgetLogicalCol(layout, seam.leftWidget);

  if (leftStoredWide) return pairLeft + pairTotal;
  if (widgetCol === seam.pairRightCol) return colStart(seam.pairRightCol);
  if (seam.dual) return pairLeft + oneWidth + gapPx / 2;
  return pairLeft + oneWidth;
}

export type SeamCellRects = {
  left?: DOMRect | null;
  right?: DOMRect | null;
};

/** 接缝两侧实际渲染列（用于对齐视觉缝隙） */
export function seamVisualCellCols(
  seam: PinSeam,
  layout: PinDesktopLayout,
): { leftCol: number | null; rightCol: number | null } {
  const norm = normalizeLayout(layout);
  const anchorCol = widgetLogicalCol(layout, seam.leftWidget);

  if (seam.rightWidget) {
    const rightCol = widgetLogicalCol(layout, seam.rightWidget);
    const leftCol = anchorCol >= 0 ? anchorCol : seam.leftCol;
    return { leftCol, rightCol: rightCol >= 0 ? rightCol : null };
  }

  if (anchorCol === seam.pairRightCol) {
    for (let col = seam.pairRightCol - 1; col >= 0; col--) {
      if (col === 1 && norm.wide[0]) continue;
      if (norm.cols[col]) return { leftCol: col, rightCol: anchorCol };
    }
    return { leftCol: null, rightCol: anchorCol };
  }

  const leftCol = anchorCol >= 0 ? anchorCol : seam.leftCol;
  if (norm.wide[seam.leftCol] && norm.cols[seam.leftCol] === seam.leftWidget) {
    for (let col = seam.pairRightCol; col < MAX_PIN_COLUMNS; col++) {
      if (norm.cols[col]) return { leftCol, rightCol: col };
    }
    return { leftCol, rightCol: null };
  }

  return { leftCol, rightCol: null };
}

/** 优先取两卡 DOM 缝隙中心，拖拽时用 overrideX */
export function resolveSeamBoundaryX(params: {
  seam: PinSeam;
  layout: PinDesktopLayout;
  gridRect: DOMRect;
  gapPx?: number;
  leftCell?: DOMRect | null;
  rightCell?: DOMRect | null;
  overrideX?: number;
}): number {
  if (params.overrideX != null) return params.overrideX;

  const { leftCell, rightCell } = params;
  const gapPx = params.gapPx ?? 8;
  const maxGapPx = 32;

  if (leftCell && rightCell) {
    const gap = rightCell.left - leftCell.right;
    if (gap >= -2 && gap <= maxGapPx) {
      return (leftCell.right + rightCell.left) / 2;
    }
    return rightCell.left - gapPx / 2;
  }
  if (leftCell) {
    return leftCell.right + gapPx / 2;
  }
  if (rightCell) {
    return rightCell.left - gapPx / 2;
  }

  return defaultSeamBoundaryX(
    params.seam,
    params.layout,
    params.gridRect,
    gapPx,
  );
}

/** 竖线是否应显示（须在相邻两卡真实缝隙处，而非逻辑空列） */
export function isSeamVisuallyPlaced(
  seam: PinSeam,
  layout: PinDesktopLayout,
  leftCell?: DOMRect | null,
  rightCell?: DOMRect | null,
  _maxGapPx = 32,
): boolean {
  const norm = normalizeLayout(layout);

  if (leftCell && rightCell) {
    if (seam.rightWidget && isWidgetWide(layout, seam.rightWidget)) {
      return false;
    }
    const gap = rightCell.left - leftCell.right;
    return gap >= -2;
  }

  if (rightCell) {
    return true;
  }

  if (leftCell && !rightCell && !seam.rightWidget) {
    if (seam.boundary === 1) {
      return (
        norm.cols[seam.leftCol] === seam.leftWidget &&
        (norm.wide[seam.leftCol] || !norm.cols[seam.pairRightCol])
      );
    }
    return (
      seam.boundary === 0 &&
      norm.cols[seam.leftCol] === seam.leftWidget &&
      !norm.wide[seam.leftCol] &&
      !norm.cols[seam.pairRightCol]
    );
  }

  return false;
}

/** 相对 grid 左缘的竖线位置（px） */
export function seamLineLeftPx(params: {
  seam: PinSeam;
  layout: PinDesktopLayout;
  gridRect: DOMRect;
  gapPx?: number;
  leftCell?: DOMRect | null;
  rightCell?: DOMRect | null;
  overrideX?: number;
}): number {
  const x = resolveSeamBoundaryX(params);
  return x - params.gridRect.left;
}

function buildPinSegmentsFromLayout(layout: PinDesktopLayout) {
  const norm = normalizeLayout(layout);
  const segments: { widget: PinWidgetId; colspan: 1 | 2 }[] = [];
  for (let col = 0; col < MAX_PIN_COLUMNS; col++) {
    if (col === 1 && norm.wide[0]) continue;
    if (col === 2 && norm.wide[1]) continue;
    const widget = norm.cols[col];
    if (!widget) continue;
    segments.push({ widget, colspan: col < 2 && norm.wide[col] ? 2 : 1 });
  }
  return segments;
}

/** 将贴边拖拽的指针 X 映射到接缝坐标（修正左右反向） */
export function resolveSeamPointerX(params: {
  seam: PinSeam;
  layout: PinDesktopLayout;
  clientX: number;
  gridRect: DOMRect;
  edge?: "left" | "right";
  actingWidget?: PinWidgetId;
  gapPx?: number;
}): number {
  const { seam, clientX, gridRect, edge, layout } = params;
  if (!edge || !params.actingWidget) return clientX;

  const gapPx = params.gapPx ?? 8;
  const norm = normalizeLayout(layout);
  const { colWidth, colStart } = columnGeometry(gridRect, gapPx);
  const pairLeft = colStart(seam.leftCol);
  const pairTotal = colWidth * 2 + gapPx;
  const pairRight = pairLeft + pairTotal;
  const mirrorX = pairRight - (clientX - pairLeft);
  const actor = params.actingWidget;

  // 右缘：卡片是接缝右卡 → 指针右移应让右卡变宽（边界左移）
  if (edge === "right" && seam.rightWidget === actor) {
    return mirrorX;
  }

  // 左缘：卡片是接缝右卡 → 指针左移应让右卡变窄（边界右移）
  if (edge === "left" && seam.rightWidget === actor) {
    return mirrorX;
  }

  // 左缘：宽卡左缘控制的是对侧边界，需镜像
  if (edge === "left" && seam.leftWidget === actor) {
    const actorCol = widgetLogicalCol(norm, actor);
    if (actorCol >= 0 && norm.wide[actorCol] && seam.boundary === 1) {
      return mirrorX;
    }
  }

  return clientX;
}

function seamResizeBounds(
  seam: PinSeam,
  layout: PinDesktopLayout | undefined,
  gridRect: DOMRect,
  gapPx: number,
) {
  const norm = layout ? normalizeLayout(layout) : null;
  const { colWidth, colStart, colMid } = columnGeometry(gridRect, gapPx);
  const pairLeft = colStart(seam.leftCol);
  const oneWidth = colWidth;

  const leftWide =
    seam.leftWidget != null &&
    norm != null &&
    isWidgetWide(norm, seam.leftWidget);
  const rightWide =
    seam.rightWidget != null &&
    norm != null &&
    isWidgetWide(norm, seam.rightWidget);

  if (leftWide && seam.rightWidget && !rightWide) {
    const rCol = widgetLogicalCol(norm!, seam.rightWidget!)!;
    const rColStart = colStart(rCol);
    const spanRight = rColStart + oneWidth;
    const minX = colStart(seam.leftCol) + oneWidth;
    const maxX = spanRight;
    return {
      pairLeft,
      pairTotal: spanRight - pairLeft,
      minX,
      maxX,
      snapLeft: colMid(seam.leftCol),
      snapRight: (minX + rColStart) / 2,
      spanRight,
      rightWide: false as const,
      oneWidth,
      gapPx,
    };
  }

  if (rightWide) {
    const rCol = widgetLogicalCol(norm!, seam.rightWidget!)!;
    const spanRight = colStart(rCol) + 2 * oneWidth + gapPx;
    const minX = colStart(seam.leftCol) + oneWidth;
    const maxX = colStart(rCol + 1);
    return {
      pairLeft,
      pairTotal: spanRight - pairLeft,
      minX,
      maxX,
      snapLeft: colMid(seam.leftCol),
      snapRight: (minX + maxX) / 2,
      spanRight,
      rightWide: true as const,
      oneWidth,
      gapPx,
    };
  }

  const pairTotal = colWidth * 2 + gapPx;
  const pairRightCol = seam.pairRightCol;
  return {
    pairLeft,
    pairTotal,
    minX: pairLeft,
    maxX: pairLeft + pairTotal,
    snapLeft: colMid(seam.leftCol),
    snapRight: colMid(pairRightCol),
    spanRight: pairLeft + pairTotal,
    rightWide: false as const,
    oneWidth,
    gapPx,
  };
}

/** 接缝拖拽：左↔右此消彼长，可双向挤压（过中线吞并邻卡） */
export function computeSeamResizePreview(params: {
  seam: PinSeam;
  clientX: number;
  gridRect: DOMRect;
  gapPx?: number;
  layout?: PinDesktopLayout;
  edge?: "left" | "right";
  actingWidget?: PinWidgetId;
}): SeamResizePreview | null {
  const { seam, gridRect, layout } = params;
  const gapPx = params.gapPx ?? 8;
  const clientX =
    layout != null
      ? resolveSeamPointerX({
          seam,
          layout,
          clientX: params.clientX,
          gridRect,
          gapPx,
          edge: params.edge,
          actingWidget: params.actingWidget,
        })
      : params.clientX;
  if (seam.pairRightCol >= MAX_PIN_COLUMNS) return null;

  const bounds = seamResizeBounds(seam, layout, gridRect, gapPx);
  const {
    pairLeft,
    pairTotal,
    minX,
    maxX,
    snapLeft,
    snapRight,
    spanRight,
    rightWide,
    oneWidth,
    gapPx: gap,
  } = bounds;

  const boundaryX = Math.max(minX, Math.min(maxX, clientX));
  const leftWidth = boundaryX - pairLeft;
  const rightWidth = Math.max(0, spanRight - boundaryX);
  const commitLeftWide = boundaryX >= snapRight;
  const commitRightWide =
    Boolean(seam.rightWidget) && boundaryX <= snapLeft;
  const leftWidePair =
    layout != null &&
    seam.rightWidget != null &&
    seam.leftWidget != null &&
    isWidgetWide(normalizeLayout(layout), seam.leftWidget) &&
    !isWidgetWide(normalizeLayout(layout), seam.rightWidget);
  const consumeRight =
    (commitLeftWide && seam.rightWidget != null && !rightWide && !leftWidePair) ||
    (leftWidePair && seam.rightWidget != null && rightWidth <= 1);
  const consumeLeft = commitRightWide && seam.leftWidget != null;

  return {
    boundaryX,
    leftWidth,
    rightWidth,
    commitLeftWide,
    commitRightWide,
    consumeRight,
    consumeLeft,
    oneWidth,
    pairLeft,
    pairTotal,
    gapPx: gap,
    snapLeft,
    snapRight,
  };
}

export function seamAffectsWidget(
  seam: PinSeam,
  widget: PinWidgetId,
): "left" | "right" | null {
  if (seam.leftWidget === widget) return "left";
  if (seam.rightWidget === widget) return "right";
  return null;
}

export function commitSeamResize(seam: PinSeam, commitLeftWide: boolean): {
  col: number;
  wide: boolean;
} {
  return { col: seam.leftCol, wide: commitLeftWide };
}

function isWidgetWide(layout: PinDesktopLayout, widget: PinWidgetId): boolean {
  const col = widgetLogicalCol(layout, widget);
  if (col < 0) return false;
  return normalizeLayout(layout).wide[col];
}

/** 提交接缝改宽（含左右双向吞并）；预览与当前布局一致时不改动 */
export function applySeamResizeCommit(
  layout: PinDesktopLayout,
  seam: PinSeam,
  preview: SeamResizePreview | boolean,
): PinDesktopLayout {
  const commit =
    typeof preview === "boolean"
      ? { commitLeftWide: preview, commitRightWide: false }
      : {
          commitLeftWide: preview.commitLeftWide,
          commitRightWide: preview.commitRightWide,
        };

  const norm = normalizeLayout(layout);

  if (!commit.commitLeftWide && !commit.commitRightWide) {
    if (!norm.wide[seam.leftCol]) return norm;
  }

  const atLeft = norm.cols[seam.leftCol] === seam.leftWidget;
  const atRight = norm.cols[seam.pairRightCol] === seam.leftWidget;

  if (commit.commitRightWide && seam.rightWidget) {
    const cols = [...norm.cols] as PinDesktopLayout["cols"];
    cols[seam.leftCol] = seam.rightWidget;
    for (let c = seam.leftCol + 1; c <= seam.pairRightCol; c++) {
      cols[c] = null;
    }
    const wide = [false, false, false] as PinDesktopLayout["wide"];
    wide[seam.leftCol] = true;
    return normalizeLayout({ ...emptyPinLayout(), cols, wide });
  }

  if (
    typeof preview !== "boolean" &&
    preview.consumeRight &&
    seam.rightWidget &&
    isWidgetWide(norm, seam.leftWidget) &&
    !isWidgetWide(norm, seam.rightWidget)
  ) {
    const cols = [...norm.cols] as PinDesktopLayout["cols"];
    const wide = [false, false, false] as PinDesktopLayout["wide"];
    cols[seam.leftCol] = seam.leftWidget;
    cols[1] = null;
    cols[2] = null;
    wide[seam.leftCol] = true;
    return normalizeLayout({ ...emptyPinLayout(), cols, wide });
  }

  if (!atLeft && atRight) {
    if (commit.commitLeftWide) {
      const cols = [...norm.cols] as PinDesktopLayout["cols"];
      cols[seam.leftCol] = seam.leftWidget;
      cols[seam.pairRightCol] = null;
      return setPinWide({ ...norm, cols }, seam.leftCol, true);
    }
    if (norm.wide[seam.leftCol] && norm.cols[seam.leftCol] === seam.leftWidget) {
      return setPinWide(norm, seam.leftCol, false);
    }
    return norm;
  }

  if (
    commit.commitLeftWide &&
    seam.rightWidget &&
    isWidgetWide(norm, seam.rightWidget)
  ) {
    const cols = [...norm.cols] as PinDesktopLayout["cols"];
    const wide = [false, false, false] as PinDesktopLayout["wide"];
    cols[seam.leftCol] = seam.leftWidget;
    cols[1] = null;
    cols[2] = seam.rightWidget;
    wide[seam.leftCol] = true;
    return normalizeLayout({ ...emptyPinLayout(), cols, wide });
  }

  if (
    !commit.commitLeftWide &&
    seam.rightWidget &&
    isWidgetWide(norm, seam.leftWidget) &&
    !isWidgetWide(norm, seam.rightWidget)
  ) {
    const cols = [...norm.cols] as PinDesktopLayout["cols"];
    const wide = [false, false, false] as PinDesktopLayout["wide"];
    cols[seam.leftCol] = seam.leftWidget;
    cols[1] = seam.rightWidget;
    cols[2] = null;
    wide[1] = true;
    return normalizeLayout({ ...emptyPinLayout(), cols, wide });
  }

  return setPinWide(norm, seam.leftCol, commit.commitLeftWide);
}

/** 卡片左缘对应的可拖拽接缝（用于贴边热区） */
export function seamForWidgetLeftEdge(
  layout: PinDesktopLayout,
  widget: PinWidgetId,
): PinSeam | null {
  const norm = normalizeLayout(layout);
  const col = widgetLogicalCol(norm, widget);
  if (col <= 0) return null;

  const seams = buildPinSeams(norm);

  if (norm.wide[col]) {
    const neighbor = seams.find((s) => s.boundary === 0 && s.rightWidget === widget);
    if (neighbor) return neighbor;
    return seams.find((s) => s.leftWidget === widget && s.boundary === 1) ?? null;
  }

  for (const seam of seams) {
    if (seam.rightWidget === widget) {
      if (isWidgetWide(norm, widget)) continue;
      return seam;
    }
    if (
      seam.leftWidget === widget &&
      col === seam.pairRightCol &&
      !seam.rightWidget
    ) {
      return seam;
    }
  }
  return null;
}

/** 卡片右缘对应的可拖拽接缝（宽卡缩回 1 格 / 向右扩张） */
export function seamForWidgetRightEdge(
  layout: PinDesktopLayout,
  widget: PinWidgetId,
): PinSeam | null {
  const norm = normalizeLayout(layout);
  const col = widgetLogicalCol(norm, widget);
  if (col < 0) return null;

  const seams = buildPinSeams(norm);
  for (const seam of seams) {
    if (seam.leftWidget !== widget) continue;

    if (norm.wide[seam.leftCol] && seam.boundary === 1) {
      return seam;
    }

    if (!norm.wide[col] && seam.boundary === 0 && !seam.rightWidget) {
      return seam;
    }

    if (!norm.wide[col] && seam.boundary === 1 && !seam.rightWidget) {
      return seam;
    }

    if (!norm.wide[col] && seam.rightWidget) {
      return seam;
    }
  }
  return null;
}
