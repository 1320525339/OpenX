import {
  MAX_PIN_COLUMNS,
  emptyPinLayout,
  isColumnMerged,
  isWidgetPinned,
  normalizeLayout,
  togglePinWidget,
  unpinWidget,
  type PinDesktopLayout,
  type PinWidgetId,
} from "./pin-desktop";
import { columnFromPointer } from "./pin-desktop-drag";

export type PinStackRow = "top" | "bottom";
export type PinDropZone = "replace" | "stack-above" | "stack-below";

export type PinDropTarget = {
  col: number;
  zone: PinDropZone;
};

/** 在同一列上停留超过该时长后，才按 Y 三等分判定叠放区 */
export const PIN_DROP_ZONE_DWELL_MS = 300;

export type ResolvePinDropTargetParams = {
  gridRect: DOMRect;
  cellRect: DOMRect | null;
  clientX: number;
  clientY: number;
  layout: PinDesktopLayout;
  gapPx?: number;
  /** 为 false 时快速掠过一律换位；停顿后才读 Y 分区 */
  dwellArmed?: boolean;
};

/** 卡片容器内按 Y 三等分：上=叠在上，中=换位，下=叠在下 */
export function dropZoneFromCellRect(cellRect: DOMRect, clientY: number): PinDropZone {
  const rel = clientY - cellRect.top;
  const third = cellRect.height / 3;
  if (rel < third) return "stack-above";
  if (rel > third * 2) return "stack-below";
  return "replace";
}

type WidgetSlot = { col: number; row: PinStackRow };

export function widgetSlot(
  layout: PinDesktopLayout,
  widget: PinWidgetId,
): WidgetSlot | null {
  const norm = normalizeLayout(layout);
  for (let col = 0; col < MAX_PIN_COLUMNS; col++) {
    if (norm.cols[col] === widget) {
      return { col, row: "top" };
    }
    if (norm.split[col] && norm.splitBottom[col] === widget) {
      return { col, row: "bottom" };
    }
  }
  return null;
}

function cloneLayout(layout: PinDesktopLayout): PinDesktopLayout {
  return {
    cols: [...layout.cols] as PinDesktopLayout["cols"],
    wide: [...layout.wide] as PinDesktopLayout["wide"],
    split: [...layout.split] as PinDesktopLayout["split"],
    splitBottom: [...layout.splitBottom] as PinDesktopLayout["splitBottom"],
  };
}

function clearSlot(
  layout: PinDesktopLayout,
  col: number,
  row: PinStackRow,
): PinDesktopLayout {
  const next = cloneLayout(normalizeLayout(layout));
  if (row === "top") {
    if (next.split[col] && next.splitBottom[col]) {
      next.cols[col] = next.splitBottom[col];
      next.splitBottom[col] = null;
      next.split[col] = false;
    } else {
      next.cols[col] = null;
      next.wide[col] = false;
    }
  } else if (next.split[col]) {
    next.splitBottom[col] = null;
    next.split[col] = false;
  }
  return normalizeLayout(next);
}

function placeSingleAtCol(
  layout: PinDesktopLayout,
  col: number,
  widget: PinWidgetId,
): PinDesktopLayout {
  const next = cloneLayout(normalizeLayout(layout));
  next.cols[col] = widget;
  next.split[col] = false;
  next.splitBottom[col] = null;
  next.wide[col] = false;
  return normalizeLayout(next);
}

/** 底栏拖入已有面板列：新面板占位列，原面板 Unpin 回底栏 */
export function replacePinWidgetAtColumn(
  layout: PinDesktopLayout,
  widget: PinWidgetId,
  toCol: number,
): PinDesktopLayout {
  if (toCol < 0 || toCol > 2) return layout;
  let norm = normalizeLayout(layout);
  const anchorCol = isColumnMerged(norm, toCol) ? toCol - 1 : toCol;
  if (anchorCol < 0 || anchorCol > 2 || isColumnMerged(norm, anchorCol)) return layout;

  if (isWidgetPinned(norm, widget)) {
    norm = unpinWidget(norm, widget);
  }

  const displaced: PinWidgetId[] = [];
  const top = norm.cols[anchorCol];
  const bottom = norm.split[anchorCol] ? norm.splitBottom[anchorCol] : null;
  if (top && top !== widget) displaced.push(top);
  if (bottom && bottom !== widget) displaced.push(bottom);
  for (const w of displaced) {
    norm = unpinWidget(norm, w);
  }

  return placeSingleAtCol(normalizeLayout(norm), anchorCol, widget);
}

function swapColumnBundles(
  layout: PinDesktopLayout,
  fromCol: number,
  toCol: number,
): PinDesktopLayout {
  if (fromCol === toCol) return layout;
  const next = cloneLayout(normalizeLayout(layout));
  const swapVal = <T,>(arr: T[], a: number, b: number) => {
    const tmp = arr[a];
    arr[a] = arr[b];
    arr[b] = tmp;
  };
  swapVal(next.cols, fromCol, toCol);
  swapVal(next.wide, fromCol, toCol);
  swapVal(next.split, fromCol, toCol);
  swapVal(next.splitBottom, fromCol, toCol);
  next.wide[2] = false;
  return normalizeLayout(next);
}

function swapRowsAtCol(layout: PinDesktopLayout, col: number): PinDesktopLayout {
  const norm = normalizeLayout(layout);
  if (!norm.split[col] || !norm.cols[col] || !norm.splitBottom[col]) return norm;
  const next = cloneLayout(norm);
  const top = next.cols[col]!;
  next.cols[col] = next.splitBottom[col]!;
  next.splitBottom[col] = top;
  return normalizeLayout(next);
}

function stackAboveSingle(
  layout: PinDesktopLayout,
  col: number,
  dragged: PinWidgetId,
): PinDesktopLayout {
  const norm = normalizeLayout(layout);
  const incumbent = norm.cols[col];
  if (!incumbent || norm.wide[col]) return norm;
  const next = cloneLayout(norm);
  next.cols[col] = dragged;
  next.splitBottom[col] = incumbent;
  next.split[col] = true;
  return normalizeLayout(next);
}

function stackBelowSingle(
  layout: PinDesktopLayout,
  col: number,
  dragged: PinWidgetId,
): PinDesktopLayout {
  const norm = normalizeLayout(layout);
  const incumbent = norm.cols[col];
  if (!incumbent || norm.wide[col]) return norm;
  const next = cloneLayout(norm);
  next.cols[col] = incumbent;
  next.splitBottom[col] = dragged;
  next.split[col] = true;
  return normalizeLayout(next);
}

function canUseStackZone(layout: PinDesktopLayout, col: number): boolean {
  const norm = normalizeLayout(layout);
  if (col < 0 || col > 2) return false;
  if (isColumnMerged(norm, col)) return false;
  if (!norm.cols[col]) return false;
  return !norm.wide[col];
}

/** 标题栏 / 底栏拖拽落点：中区换位，上下区 50/50 垂直叠放 */
export function applyPinDropIntent(
  layout: PinDesktopLayout,
  widget: PinWidgetId,
  toCol: number,
  zone: PinDropZone,
): PinDesktopLayout {
  if (toCol < 0 || toCol > 2) return layout;

  let norm = normalizeLayout(layout);
  const from = widgetSlot(norm, widget);
  if (!from) return norm;

  const effectiveZone =
    canUseStackZone(norm, toCol) || norm.cols[toCol] == null ? zone : "replace";

  if (from.col === toCol) {
    if (effectiveZone === "replace") return norm;
    if (!norm.split[toCol]) return norm;
    if (from.row === "top" && effectiveZone === "stack-below") {
      return swapRowsAtCol(norm, toCol);
    }
    if (from.row === "bottom" && effectiveZone === "stack-above") {
      return swapRowsAtCol(norm, toCol);
    }
    return norm;
  }

  if (norm.cols[toCol] == null) {
    norm = clearSlot(norm, from.col, from.row);
    return placeSingleAtCol(norm, toCol, widget);
  }

  if (effectiveZone === "replace" || norm.wide[toCol]) {
    return swapColumnBundles(norm, from.col, toCol);
  }

  norm = clearSlot(norm, from.col, from.row);

  if (effectiveZone === "stack-above") {
    if (norm.split[toCol]) {
      const displaced = norm.cols[toCol]!;
      let next = stackAboveSingle(norm, toCol, widget);
      const emptyCol = norm.cols.findIndex((c, i) => c == null && !isColumnMerged(next, i));
      if (emptyCol >= 0) {
        next = placeSingleAtCol(next, emptyCol, displaced);
      }
      return next;
    }
    return stackAboveSingle(norm, toCol, widget);
  }

  if (norm.split[toCol]) {
    const displaced = norm.splitBottom[toCol]!;
    let next = stackBelowSingle(norm, toCol, widget);
    const emptyCol = norm.cols.findIndex((c, i) => c == null && !isColumnMerged(next, i));
    if (emptyCol >= 0) {
      next = placeSingleAtCol(next, emptyCol, displaced);
    }
    return next;
  }

  return stackBelowSingle(norm, toCol, widget);
}

export function placePinWidgetAtDrop(
  layout: PinDesktopLayout,
  widget: PinWidgetId,
  toCol: number,
  zone: PinDropZone,
): PinDesktopLayout {
  if (toCol < 0 || toCol > 2) return layout;
  let norm = normalizeLayout(layout);
  const wasPinned = isWidgetPinned(norm, widget);
  const from = wasPinned ? widgetSlot(norm, widget) : null;

  const effectiveZone =
    canUseStackZone(norm, toCol) || norm.cols[toCol] == null ? zone : "replace";

  const targetOccupied = norm.cols[toCol] != null || isColumnMerged(norm, toCol);
  const sameColumn = from?.col === toCol || (from && isColumnMerged(norm, toCol) && from.col === toCol - 1);

  if (effectiveZone === "replace" && targetOccupied && !sameColumn) {
    return replacePinWidgetAtColumn(norm, widget, toCol);
  }

  if (!wasPinned) {
    norm = togglePinWidget(norm, widget);
  }
  if (!widgetSlot(norm, widget)) return norm;
  return applyPinDropIntent(norm, widget, toCol, zone);
}

export function resolvePinDropTarget(params: ResolvePinDropTargetParams): PinDropTarget {
  const gapPx = params.gapPx ?? 8;
  const col = columnFromPointer(params.gridRect, params.clientX, gapPx);
  const norm = normalizeLayout(params.layout);
  if (!params.cellRect || norm.cols[col] == null) {
    return { col, zone: "replace" };
  }
  if (norm.wide[col] || isColumnMerged(norm, col)) {
    return { col, zone: "replace" };
  }
  if (!params.dwellArmed) {
    return { col, zone: "replace" };
  }
  return { col, zone: dropZoneFromCellRect(params.cellRect, params.clientY) };
}

export type PinDropTargetTracker = {
  reset: () => void;
  resolve: (params: Omit<ResolvePinDropTargetParams, "dwellArmed">, now?: number) => PinDropTarget;
};

/** 追踪列内停留时长：掠过即换位，停顿后才启用上下叠放分区 */
export function createPinDropTargetTracker(
  dwellMs = PIN_DROP_ZONE_DWELL_MS,
): PinDropTargetTracker {
  let hoverCol: number | null = null;
  let enteredAt = 0;

  return {
    reset() {
      hoverCol = null;
      enteredAt = 0;
    },
    resolve(params, now = Date.now()) {
      const gapPx = params.gapPx ?? 8;
      const col = columnFromPointer(params.gridRect, params.clientX, gapPx);
      if (col !== hoverCol) {
        hoverCol = col;
        enteredAt = now;
      }
      const dwellArmed = now - enteredAt >= dwellMs;
      return resolvePinDropTarget({ ...params, dwellArmed });
    },
  };
}

export function emptySplitFields(): Pick<PinDesktopLayout, "split" | "splitBottom"> {
  const base = emptyPinLayout();
  return { split: base.split, splitBottom: base.splitBottom };
}
