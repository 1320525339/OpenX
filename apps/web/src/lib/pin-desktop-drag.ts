import { MAX_PIN_COLUMNS } from "./pin-desktop";

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
