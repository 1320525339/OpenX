import { MAX_PIN_COLUMNS, type PinWidgetId } from "./pin-desktop";

export const PIN_DRAG_MOVE_THRESHOLD = 4;

export type ColumnGeometry = {
  colWidth: number;
  colStart: (col: number) => number;
  colEnd: (col: number) => number;
  colMid: (col: number) => number;
};

export function columnGeometry(gridRect: DOMRect, gapPx: number): ColumnGeometry {
  const totalGap = gapPx * (MAX_PIN_COLUMNS - 1);
  const colWidth = (gridRect.width - totalGap) / MAX_PIN_COLUMNS;
  const colStart = (col: number) => gridRect.left + col * colWidth + col * gapPx;
  const colEnd = (col: number) => colStart(col) + colWidth;
  const colMid = (col: number) => colStart(col) + colWidth / 2;
  return { colWidth, colStart, colEnd, colMid };
}

/** 根据指针 X 坐标判断落在第几列（0-2） */
export function columnFromPointer(
  gridRect: DOMRect,
  clientX: number,
  gapPx = 8,
): number {
  const { colStart } = columnGeometry(gridRect, gapPx);
  for (let col = MAX_PIN_COLUMNS - 1; col >= 0; col--) {
    if (clientX >= colStart(col)) return col;
  }
  return 0;
}

export type ResizePreview = {
  previewWidth: number;
  commitWide: boolean;
  hideNeighbor: boolean;
  oneWidth: number;
  twoWidth: number;
  cellLeft: number;
  snapX: number;
  rightEdge: number;
};

/** 拉伸预览：宽度跟手，过邻列中线才吞并邻卡 */
export function computeResizePreview(params: {
  col: number;
  clientX: number;
  gridRect: DOMRect;
  gapPx?: number;
  adjacentWidget: PinWidgetId | null;
  edge?: "left" | "right";
  anchorRight?: number;
}): ResizePreview | null {
  const { col, clientX, gridRect, adjacentWidget } = params;
  const gapPx = params.gapPx ?? 8;
  const edge = params.edge ?? "right";
  if (col < 0 || col > 1) return null;

  const { colWidth, colStart, colMid } = columnGeometry(gridRect, gapPx);
  const adjacentCol = col + 1;
  if (adjacentCol >= MAX_PIN_COLUMNS) return null;

  const cellLeft = colStart(col);
  const oneWidth = colWidth;
  const twoWidth = colWidth * 2 + gapPx;
  const snapX = colMid(adjacentCol);
  const anchorRight = params.anchorRight ?? cellLeft + twoWidth;

  let previewWidth: number;
  if (edge === "left") {
    previewWidth = Math.max(oneWidth, Math.min(twoWidth, anchorRight - clientX));
  } else {
    previewWidth = Math.max(oneWidth, Math.min(twoWidth, clientX - cellLeft));
  }

  const rightEdge = cellLeft + previewWidth;
  const commitWide = rightEdge >= snapX;
  const hideNeighbor = commitWide && adjacentWidget != null;

  return {
    previewWidth,
    commitWide,
    hideNeighbor,
    oneWidth,
    twoWidth,
    cellLeft,
    snapX,
    rightEdge,
  };
}

/** @deprecated 用 computeResizePreview */
export function resolveWideFromResizePointer(
  col: number,
  clientX: number,
  gridRect: DOMRect,
  gapPx = 8,
): boolean {
  return computeResizePreview({
    col,
    clientX,
    gridRect,
    gapPx,
    adjacentWidget: "chat",
  })?.commitWide ?? false;
}
