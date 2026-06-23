import {
  columnSpan,
  emptyPinLayout,
  isColumnMerged,
  MAX_PIN_COLUMNS,
  normalizeLayout,
  setPinSpan,
  setWidgetSpan,
  shrinkCol1WideToSingle,
  widgetColumnSpan,
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
  /** 第一栏 boundary-1 接缝：对称 snap 后的目标档位 */
  commitSpan?: 1 | 2 | 3;
  oneWidth: number;
  pairLeft: number;
  pairTotal: number;
  spanRight: number;
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
    if (norm.wide[2]) {
      seams.push({
        boundary: 1,
        leftCol: 0,
        leftWidget: norm.cols[0],
        pairRightCol: 2,
        rightWidget: null,
        dual: true,
      });
    } else if (norm.cols[2] && !norm.cols[1]) {
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
        pairRightCol: norm.cols[1] != null ? 1 : 2,
        rightWidget: norm.cols[1],
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
  const segments = buildPinSegmentsFromLayout(layout);
  const leftSeg = segments.find((s) => s.widget === seam.leftWidget);
  const leftSpan = leftSeg?.colspan ?? 1;
  const widgetCol = widgetLogicalCol(layout, seam.leftWidget);

  if (leftSpan >= 2) {
    const spanCols = leftSpan;
    const edge = pairLeft + spanCols * oneWidth + (spanCols - 1) * gapPx;
    // span-3 静止时把接缝放在 2 列档（避免贴右缘被 overflow:hidden 裁切）
    if (leftSpan === 3) {
      return pairLeft + 2 * oneWidth + gapPx;
    }
    return edge;
  }
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
      // boundary-0：左窄右宽时仍显示接缝，用于 1→2 挤压宽卡
      const norm = normalizeLayout(layout);
      if (!(seam.boundary === 0 && !norm.wide[seam.leftCol])) {
        return false;
      }
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
  const segments: { widget: PinWidgetId; colspan: 1 | 2 | 3 }[] = [];
  for (let col = 0; col < MAX_PIN_COLUMNS; col++) {
    if (isColumnMerged(norm, col)) continue;
    const widget = norm.cols[col];
    if (!widget) continue;
    segments.push({ widget, colspan: columnSpan(norm, col) });
  }
  return segments;
}

/** 按卡片锚点列与右缘位置 snap 到 1/2/3 列档位（任意锚点均可扩至全宽） */
export function resolveWidgetSpanTier(params: {
  anchorCol: number;
  boundaryX: number;
  pairLeft: number;
  oneWidth: number;
  gapPx: number;
  gridSpanRight: number;
}): 1 | 2 | 3 {
  const left = params.pairLeft;
  const snap1 = left + params.oneWidth;
  const snap2 = left + 2 * params.oneWidth + params.gapPx;
  const snap3 = params.gridSpanRight;
  const snaps: Array<{ tier: 1 | 2 | 3; x: number }> = [
    { tier: 1, x: snap1 },
    { tier: 2, x: snap2 },
    { tier: 3, x: snap3 },
  ];
  let best = snaps[0]!;
  let bestDist = Math.abs(params.boundaryX - best.x);
  for (const snap of snaps) {
    const dist = Math.abs(params.boundaryX - snap.x);
    if (dist < bestDist) {
      best = snap;
      bestDist = dist;
    }
  }
  return best.tier;
}

function maxLeftExpandSpan(norm: PinDesktopLayout, anchorCol: number): 1 | 2 | 3 {
  if (anchorCol === 2 && norm.cols[0] == null && !norm.wide[0]) return 3;
  if (anchorCol >= 1) return 2;
  return 1;
}

/** 右栏卡片向左扩：根据 seam 位置 snap 到 1/2/3 列档位 */
export function resolveWidgetLeftExpandTier(params: {
  boundaryX: number;
  anchorCol: number;
  colStart: (col: number) => number;
  maxSpan: 1 | 2 | 3;
  defaultX: number;
  snapRight: number;
  oneWidth: number;
}): 1 | 2 | 3 {
  const expanding =
    params.boundaryX < params.defaultX || params.boundaryX >= params.snapRight;
  if (!expanding) return 1;

  if (
    params.maxSpan >= 3 &&
    params.boundaryX <= params.colStart(0) + params.oneWidth / 2
  ) {
    return 3;
  }
  if (
    params.maxSpan >= 2 &&
    params.boundaryX <= params.colStart(params.anchorCol - 1) + params.oneWidth / 2
  ) {
    return 2;
  }
  if (params.boundaryX >= params.snapRight) return params.maxSpan >= 2 ? 2 : 1;
  return 1;
}

/** @deprecated 使用 resolveWidgetSpanTier */
export function resolveCol0SpanTier(preview: {
  boundaryX: number;
  pairLeft: number;
  oneWidth: number;
  gapPx: number;
  spanRight: number;
}): 1 | 2 | 3 {
  return resolveWidgetSpanTier({
    anchorCol: 0,
    boundaryX: preview.boundaryX,
    pairLeft: preview.pairLeft,
    oneWidth: preview.oneWidth,
    gapPx: preview.gapPx,
    gridSpanRight: preview.spanRight,
  });
}

function seamExpandTier(preview: SeamResizePreview): 1 | 2 | 3 {
  if (preview.commitSpan != null) return preview.commitSpan;
  return preview.commitLeftWide ? 2 : 1;
}

function pickPeakSeamPreview(
  prev: SeamResizePreview,
  next: SeamResizePreview,
): SeamResizePreview {
  const prevTier = seamExpandTier(prev);
  const nextTier = seamExpandTier(next);
  if (nextTier !== prevTier) return nextTier > prevTier ? next : prev;
  return next.boundaryX >= prev.boundaryX ? next : prev;
}

function pickMinSeamPreview(
  prev: SeamResizePreview,
  next: SeamResizePreview,
): SeamResizePreview {
  const prevTier = seamExpandTier(prev);
  const nextTier = seamExpandTier(next);
  if (nextTier !== prevTier) return nextTier < prevTier ? next : prev;
  return next.boundaryX <= prev.boundaryX ? next : prev;
}

export { pickPeakSeamPreview, pickMinSeamPreview };

/** 松手提交：扩宽取 peak、缩窄取 min，避免松手回弹丢档位 */
export function pickSeamCommitPreview(
  startPreview: SeamResizePreview,
  minPreview: SeamResizePreview,
  maxPreview: SeamResizePreview,
  releasePreview: SeamResizePreview | null,
): SeamResizePreview {
  const release = releasePreview ?? maxPreview;
  const startTier = seamExpandTier(startPreview);
  const releaseTier = seamExpandTier(release);
  const minTier = seamExpandTier(minPreview);
  const maxTier = seamExpandTier(maxPreview);

  if (releaseTier < startTier || (releaseTier === startTier && minTier < startTier)) {
    return minTier < startTier ? minPreview : release;
  }
  if (releaseTier > startTier || (releaseTier === startTier && maxTier > startTier)) {
    return maxTier > startTier ? maxPreview : release;
  }
  return release;
}

/** 将贴边拖拽的指针 X 映射到接缝坐标（修正左右反向） */
export function resolveSeamPointerX(params: {
  seam: PinSeam;
  layout: PinDesktopLayout;
  clientX: number;
  gridRect: DOMRect;
  gapPx?: number;
}): number {
  return params.clientX;
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

  const leftCol =
    seam.leftWidget != null && norm != null
      ? widgetLogicalCol(norm, seam.leftWidget)
      : -1;
  const leftSpan = leftCol >= 0 ? columnSpan(norm!, leftCol) : 1;
  const leftWide = leftSpan >= 2;
  const rightCol =
    seam.rightWidget != null && norm != null
      ? widgetLogicalCol(norm, seam.rightWidget)
      : -1;
  const rightWide = rightCol >= 0 ? columnSpan(norm!, rightCol) >= 2 : false;

  if (
    norm &&
    seam.boundary === 0 &&
    seam.leftCol === 0 &&
    norm.cols[0] === seam.leftWidget &&
    !norm.wide[0]
  ) {
    const spanRight = colStart(2) + oneWidth;
    const minX = colStart(0) + oneWidth;
    return {
      pairLeft: colStart(0),
      pairTotal: spanRight - colStart(0),
      minX,
      maxX: spanRight,
      snapLeft: colMid(0),
      snapRight: colMid(1),
      spanRight,
      rightWide: false as const,
      oneWidth,
      gapPx,
    };
  }

  if (leftWide && norm?.wide[0] && norm.wide[2]) {
    const spanRight = colStart(2) + oneWidth;
    const minX = colStart(seam.leftCol) + oneWidth;
    return {
      pairLeft,
      pairTotal: spanRight - pairLeft,
      minX,
      maxX: spanRight,
      snapLeft: colMid(seam.leftCol),
      snapRight: colMid(1),
      spanRight,
      rightWide: false as const,
      oneWidth,
      gapPx,
    };
  }

  if (leftWide && !seam.rightWidget && norm && seam.leftCol === 0 && !norm.wide[2]) {
    const spanRight = colStart(2) + oneWidth;
    const minX = colStart(seam.leftCol) + oneWidth;
    return {
      pairLeft,
      pairTotal: spanRight - pairLeft,
      minX,
      maxX: spanRight,
      snapLeft: colMid(seam.leftCol),
      snapRight: colMid(1),
      spanRight,
      rightWide: false as const,
      oneWidth,
      gapPx,
    };
  }

  if (leftWide && seam.rightWidget && !rightWide) {
    const rCol = widgetLogicalCol(norm!, seam.rightWidget!)!;
    const rColStart = colStart(rCol);
    const gridRight = colStart(2) + oneWidth;
    const spanRight = seam.leftCol === 0 ? gridRight : rColStart + oneWidth;
    const minX = colStart(seam.leftCol) + oneWidth;
    const maxX = spanRight;
    return {
      pairLeft,
      pairTotal: spanRight - pairLeft,
      minX,
      maxX,
      snapLeft: colMid(seam.leftCol),
      snapRight: seam.leftCol === 0 && rCol === 2 ? gridRight - oneWidth / 2 : (minX + rColStart) / 2,
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

  const anchorCol =
    norm && seam.leftWidget != null ? widgetLogicalCol(norm, seam.leftWidget) : -1;
  if (
    norm &&
    seam.boundary === 1 &&
    anchorCol >= 0 &&
    anchorCol <= 1 &&
    norm.cols[anchorCol] === seam.leftWidget &&
    !seam.rightWidget
  ) {
    const gridRight = colStart(2) + oneWidth;
    const anchorLeft = colStart(anchorCol);
    const minX = anchorLeft + oneWidth;
    return {
      pairLeft: anchorLeft,
      pairTotal: gridRight - anchorLeft,
      minX,
      maxX: gridRight,
      snapLeft: colMid(Math.max(0, anchorCol - 1)),
      snapRight: colMid(Math.min(2, anchorCol + 1)),
      spanRight: gridRight,
      rightWide: false as const,
      oneWidth,
      gapPx,
    };
  }

  if (
    norm &&
    seam.boundary === 1 &&
    leftCol === 2 &&
    seam.leftCol !== leftCol &&
    norm.cols[2] === seam.leftWidget &&
    !leftWide
  ) {
    const maxSpan = maxLeftExpandSpan(norm, leftCol);
    const gridRight = colStart(2) + oneWidth;
    const minX = maxSpan >= 3 ? colStart(0) : colStart(1);
    return {
      pairLeft: colStart(seam.leftCol),
      pairTotal: gridRight - colStart(seam.leftCol),
      minX,
      maxX: gridRight,
      snapLeft: colMid(seam.leftCol),
      snapRight: colMid(2),
      spanRight: gridRight,
      rightWide: false as const,
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

  const norm = layout ? normalizeLayout(layout) : null;
  const anchorCol =
    norm && seam.leftWidget != null ? widgetLogicalCol(norm, seam.leftWidget) : -1;
  const { colStart } = columnGeometry(gridRect, gapPx);
  const leftExpandMax =
    norm &&
    anchorCol >= 0 &&
    anchorCol !== seam.leftCol &&
    norm.cols[anchorCol] === seam.leftWidget &&
    seam.boundary === 1
      ? maxLeftExpandSpan(norm, anchorCol)
      : null;
  const leftExpandDefaultX = leftExpandMax != null ? colStart(anchorCol) : null;
  const leftExpandTier =
    leftExpandMax != null && leftExpandDefaultX != null
      ? resolveWidgetLeftExpandTier({
          boundaryX,
          anchorCol,
          colStart,
          maxSpan: leftExpandMax,
          defaultX: leftExpandDefaultX,
          snapRight,
          oneWidth,
        })
      : undefined;
  const tierPairLeft =
    anchorCol >= 0 && anchorCol !== seam.leftCol
      ? pairLeft + oneWidth + gap
      : pairLeft;
  const widgetSpanTier =
    norm &&
    anchorCol >= 0 &&
    anchorCol === seam.leftCol &&
    norm.cols[anchorCol] === seam.leftWidget &&
    (seam.boundary === 1 || (seam.boundary === 0 && anchorCol === 0))
      ? resolveWidgetSpanTier({
          anchorCol,
          boundaryX,
          pairLeft: tierPairLeft,
          oneWidth,
          gapPx: gap,
          gridSpanRight: spanRight,
        })
      : undefined;

  const col0Tier = widgetSpanTier;

  const commitLeftWide = leftExpandTier
    ? leftExpandTier >= 2
    : col0Tier
      ? col0Tier >= 2
      : boundaryX >= snapRight;
  const commitRightWide =
    Boolean(seam.rightWidget) && boundaryX <= snapLeft;
  const consumeRight =
    (col0Tier === 3 && seam.rightWidget != null && !rightWide) ||
    (commitLeftWide &&
      col0Tier == null &&
      seam.rightWidget != null &&
      !rightWide &&
      !(
        norm &&
        seam.leftWidget != null &&
        isWidgetWide(norm, seam.leftWidget) &&
        seam.rightWidget != null &&
        !isWidgetWide(norm, seam.rightWidget)
      ));
  const consumeLeft = commitRightWide && seam.leftWidget != null;

  return {
    boundaryX,
    leftWidth,
    rightWidth,
    commitLeftWide,
    commitRightWide,
    consumeRight,
    consumeLeft,
    commitSpan: leftExpandTier ?? col0Tier,
    oneWidth,
    pairLeft,
    pairTotal,
    spanRight,
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

/** boundary-0 右拖：左/中均为单列且第三栏空时，优先扩第二栏（避免误扩第一栏把中列挤到第三栏） */
function preferBoundary0MiddleExpand(
  norm: PinDesktopLayout,
  seam: PinSeam,
  target: 1 | 2 | 3,
): PinDesktopLayout | null {
  if (target !== 2) return null;
  if (seam.boundary !== 0 || seam.leftCol !== 0 || !seam.rightWidget) return null;
  if (norm.wide[0] || norm.wide[1]) return null;
  if (isWidgetWide(norm, seam.rightWidget)) return null;
  if (widgetLogicalCol(norm, seam.rightWidget) !== 1) return null;
  if (norm.cols[2] != null || norm.split[2]) return null;
  return setPinSpan(norm, 1, 2);
}

/** 提交接缝改宽：任意档位变更统一走 setWidgetSpan */
export function applySeamResizeCommit(
  layout: PinDesktopLayout,
  seam: PinSeam,
  preview: SeamResizePreview | boolean,
): PinDesktopLayout {
  const norm = normalizeLayout(layout);

  if (typeof preview !== "boolean" && seam.leftWidget) {
    const anchorCol = widgetLogicalCol(norm, seam.leftWidget);
    if (
      !preview.commitRightWide &&
      anchorCol >= 0 &&
      anchorCol === seam.leftCol &&
      norm.cols[anchorCol] === seam.leftWidget &&
      (seam.boundary === 1 || (seam.boundary === 0 && anchorCol === 0))
    ) {
      const tierPairLeft =
        anchorCol !== seam.leftCol
          ? preview.pairLeft + preview.oneWidth + preview.gapPx
          : preview.pairLeft;
      const target = preview.commitSpan ?? resolveWidgetSpanTier({
        anchorCol,
        boundaryX: preview.boundaryX,
        pairLeft: tierPairLeft,
        oneWidth: preview.oneWidth,
        gapPx: preview.gapPx,
        gridSpanRight: preview.spanRight,
      });
      const current = widgetColumnSpan(norm, seam.leftWidget);
      if (target !== current) {
        const middleExpand = preferBoundary0MiddleExpand(norm, seam, target);
        if (middleExpand) return middleExpand;
        return setWidgetSpan(norm, seam.leftWidget, target);
      }
      return norm;
    }
  }

  const commit =
    typeof preview === "boolean"
      ? { commitLeftWide: preview, commitRightWide: false }
      : {
          commitLeftWide: preview.commitLeftWide,
          commitRightWide: preview.commitRightWide,
        };

  if (commit.commitLeftWide && seam.boundary === 0 && norm.cols[seam.leftCol] === seam.leftWidget) {
    const middleExpand = preferBoundary0MiddleExpand(norm, seam, 2);
    if (middleExpand) return middleExpand;
    return setPinSpan(norm, seam.leftCol, 2);
  }

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

  const atLeft = norm.cols[seam.leftCol] === seam.leftWidget;
  const atRight = norm.cols[seam.pairRightCol] === seam.leftWidget;

  if (!atLeft && atRight) {
    if (commit.commitLeftWide) {
      const target =
        typeof preview !== "boolean" && preview.commitSpan != null
          ? preview.commitSpan
          : 2;
      if (target === 3) {
        return setWidgetSpan(norm, seam.leftWidget, 3);
      }
      const cols = [...norm.cols] as PinDesktopLayout["cols"];
      cols[seam.leftCol] = seam.leftWidget;
      cols[seam.pairRightCol] = null;
      const wide = [false, false, false] as PinDesktopLayout["wide"];
      return setPinSpan({ ...norm, cols, wide }, seam.leftCol, 2);
    }
    if (norm.wide[seam.leftCol] && norm.cols[seam.leftCol] === seam.leftWidget) {
      if (typeof preview !== "boolean" && preview.commitSpan === 1) {
        return setWidgetSpan(norm, seam.leftWidget, 1);
      }
      if (seam.leftCol === 1 && !norm.cols[0] && !norm.wide[0]) {
        return shrinkCol1WideToSingle(norm);
      }
      return setWidgetSpan(norm, seam.leftWidget, 1);
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

  if (typeof preview === "boolean" && !preview && norm.wide[seam.leftCol]) {
    return setWidgetSpan(norm, seam.leftWidget!, 1);
  }

  if (typeof preview !== "boolean") {
    const wantsMiddleWide =
      preview.commitLeftWide || preview.boundaryX >= preview.snapRight;
    if (
      seam.boundary === 1 &&
      seam.leftCol === 1 &&
      norm.cols[1] === seam.leftWidget &&
      !norm.wide[1] &&
      wantsMiddleWide
    ) {
      const expanded = setWidgetSpan(norm, seam.leftWidget, 2);
      if (widgetColumnSpan(expanded, seam.leftWidget) >= 2) return expanded;
    }
    if (
      seam.boundary === 0 &&
      seam.leftCol === 0 &&
      seam.rightWidget &&
      widgetLogicalCol(norm, seam.rightWidget) === 1 &&
      !norm.wide[0] &&
      !norm.wide[1] &&
      norm.cols[2] == null &&
      ((preview.commitSpan ?? 0) >= 2 || preview.commitLeftWide)
    ) {
      const expanded = preferBoundary0MiddleExpand(norm, seam, 2);
      if (expanded?.wide[1]) return expanded;
    }
  }

  if (typeof preview !== "boolean" && seam.leftWidget && preview.commitSpan != null) {
    const current = widgetColumnSpan(norm, seam.leftWidget);
    if (preview.commitSpan !== current) {
      return setWidgetSpan(norm, seam.leftWidget, preview.commitSpan);
    }
  }

  return norm;
}

