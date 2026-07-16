import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  PIN_WIDGET_LABELS,
  buildLogicalGridTemplate,
  buildPinSegments,
  extensionSlotColumns,
  normalizeLayout,
  pinnedWidgets,
  type PinDockWidgetId,
  type PinDesktopLayout,
  type PinWidgetId,
} from "../../lib/pin-desktop";
import {
  createPinDropTargetTracker,
  PIN_DROP_ZONE_DWELL_MS,
  resolvePinDropColumn,
  type PinDropZone,
  type PinStackRow,
} from "../../lib/pin-desktop-drop";
import {
  PIN_DRAG_MOVE_THRESHOLD,
  columnGeometry,
} from "../../lib/pin-desktop-drag";
import {
  applySeamResizeCommit,
  buildPinSeams,
  computeSeamResizePreview,
  isSeamVisuallyPlaced,
  seamAffectsWidget,
  seamLineLeftPx,
  seamVisualCellCols,
  type PinSeam,
  type SeamResizePreview,
} from "../../lib/pin-desktop-seam";
import { FlexibleWidgetFrame } from "./FlexibleWidgetFrame";
import { PinExtensionCard } from "./PinExtensionCard";

type Props = {
  layout: PinDesktopLayout;
  widgets: Partial<Record<PinWidgetId, ReactNode>>;
  getSlotLabel?: (widget: PinWidgetId) => string;
  onUnpin: (widget: PinWidgetId) => void;
  onApplyDrop: (widget: PinWidgetId, toCol: number, zone: PinDropZone) => void;
  onSeamCommit?: (seam: PinSeam, preview: SeamResizePreview) => void;
  dockDragWidget?: PinWidgetId | null;
  dockDragOverCol?: number | null;
  dockDragOverZone?: PinDropZone | null;
  onGridRectChange?: (rect: DOMRect) => void;
  onBindCellRect?: (getter: (col: number) => DOMRect | null) => void;
  onPinWidgetAtCol?: (col: number, widget: PinDockWidgetId) => boolean;
  onAddTemplateAtCol?: (col: number, templateId: string) => boolean;
  isDockWidgetPinned?: (widget: PinDockWidgetId) => boolean;
  pageIndex?: number;
  pageCount?: number;
};

type DragSession = {
  fromCol: number;
  widget: PinWidgetId;
  pointerId: number;
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  colspan: 1 | 2 | 3;
  overCol: number | null;
  overZone: PinDropZone | null;
};

type PendingDrag = {
  fromCol: number;
  widget: PinWidgetId;
  pointerId: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  colspan: 1 | 2 | 3;
};

type PendingSeamResize = {
  seam: PinSeam;
  pointerId: number;
  startX: number;
  startY: number;
};

type SeamResizeSession = PendingSeamResize & {
  preview: SeamResizePreview;
};

const GRID_GAP_PX = 8;

export function PinDesktopCanvas({
  layout,
  widgets,
  getSlotLabel,
  onUnpin,
  onApplyDrop,
  onSeamCommit,
  dockDragWidget = null,
  dockDragOverCol = null,
  dockDragOverZone = null,
  onGridRectChange,
  onBindCellRect,
  onPinWidgetAtCol,
  onAddTemplateAtCol,
  isDockWidgetPinned,
  pageIndex = 0,
  pageCount = 1,
}: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const overlayRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<PendingDrag | null>(null);
  const dragRef = useRef<DragSession | null>(null);
  const seamRef = useRef<SeamResizeSession | null>(null);
  const pendingSeamRef = useRef<PendingSeamResize | null>(null);
  const dropTargetTrackerRef = useRef(createPinDropTargetTracker());

  const [drag, setDrag] = useState<DragSession | null>(null);
  const [seamResize, setSeamResize] = useState<SeamResizeSession | null>(null);
  const [trackPointer, setTrackPointer] = useState(false);
  const [gridBox, setGridBox] = useState<DOMRect | null>(null);

  const slotLabel = useCallback(
    (widget: PinWidgetId) =>
      getSlotLabel?.(widget) ?? PIN_WIDGET_LABELS[widget as PinDockWidgetId] ?? "卡片",
    [getSlotLabel],
  );
  const pinnedCount = pinnedWidgets(layout).length;
  const isDragging = drag != null;
  const isResizing = seamResize != null;
  const displayLayout = layout;

  const layoutForExtensionSlots = useMemo(() => {
    const base =
      seamResize == null
        ? displayLayout
        : applySeamResizeCommit(
            normalizeLayout(displayLayout),
            seamResize.seam,
            seamResize.preview,
          );
    return normalizeLayout(base);
  }, [displayLayout, seamResize]);

  const displaySegments = buildPinSegments(displayLayout);
  const normLayout = normalizeLayout(displayLayout);
  const gridTemplateColumns = useMemo(
    () => buildLogicalGridTemplate(displayLayout),
    [displayLayout],
  );

  const seams = useMemo(() => buildPinSeams(displayLayout), [displayLayout]);

  const getCellRect = useCallback(
    (col: number) => cellRefs.current[col]?.getBoundingClientRect() ?? null,
    [],
  );

  useEffect(() => {
    onBindCellRect?.(getCellRect);
  }, [onBindCellRect, getCellRect]);

  const syncGridBox = useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    setGridBox(rect);
    onGridRectChange?.(rect);
  }, [onGridRectChange]);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    syncGridBox();
    const observer = new ResizeObserver(syncGridBox);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [layout, isDragging, isResizing, drag?.overCol, dockDragOverCol, pinnedCount, syncGridBox]);

  const applyOverlayTransform = useCallback((x: number, y: number, offsetX: number, offsetY: number) => {
    const el = overlayRef.current;
    if (!el) return;
    el.style.transform = `translate3d(${x - offsetX}px, ${y - offsetY}px, 0) scale(1.035)`;
  }, []);

  const beginDrag = useCallback(
    (pending: PendingDrag, x: number, y: number) => {
      pendingRef.current = null;
      dropTargetTrackerRef.current.reset();
      const session: DragSession = {
        ...pending,
        x,
        y,
        overCol: pending.fromCol,
        overZone: null,
      };
      dragRef.current = session;
      setDrag(session);
      setTrackPointer(true);
      document.body.classList.add("pin-desktop-body-dragging");
      requestAnimationFrame(() => applyOverlayTransform(x, y, pending.offsetX, pending.offsetY));
    },
    [applyOverlayTransform],
  );

  const endDrag = useCallback(
    (session: DragSession | null) => {
      pendingRef.current = null;
      dragRef.current = null;
      dropTargetTrackerRef.current.reset();
      setDrag(null);
      setTrackPointer(false);
      document.body.classList.remove("pin-desktop-body-dragging");
      if (
        session &&
        session.overCol != null &&
        (session.overCol !== session.fromCol ||
          (session.overZone && session.overZone !== "replace"))
      ) {
        onApplyDrop(session.widget, session.overCol, session.overZone ?? "replace");
      }
    },
    [onApplyDrop],
  );

  const resolveDragTarget = useCallback(
    (clientX: number, clientY: number) => {
      const grid = gridRef.current;
      if (!grid) return { col: 0, zone: "replace" as PinDropZone };
      const gridRect = grid.getBoundingClientRect();
      const col = resolvePinDropColumn({
        gridRect,
        clientX,
        layout: displayLayout,
        gapPx: GRID_GAP_PX,
        getCellRect,
      });
      return dropTargetTrackerRef.current.resolve({
        gridRect,
        cellRect: getCellRect(col),
        clientX,
        clientY,
        layout: displayLayout,
        gapPx: GRID_GAP_PX,
        targetCol: col,
      });
    },
    [displayLayout, getCellRect],
  );

  const updateDragPointer = useCallback(
    (clientX: number, clientY: number) => {
      const current = dragRef.current;
      if (!current) return;

      const { col: overCol, zone: overZone } = resolveDragTarget(clientX, clientY);
      applyOverlayTransform(clientX, clientY, current.offsetX, current.offsetY);

      if (overCol !== current.overCol || overZone !== current.overZone) {
        const next: DragSession = { ...current, x: clientX, y: clientY, overCol, overZone };
        dragRef.current = next;
        setDrag(next);
        return;
      }

      dragRef.current = { ...current, x: clientX, y: clientY, overCol, overZone };
    },
    [applyOverlayTransform, resolveDragTarget],
  );

  const onHeaderPointerDown = useCallback(
    (col: number, widget: PinWidgetId, colspan: 1 | 2 | 3, e: ReactPointerEvent) => {
      if (e.button !== 0 || isResizing) return;
      if ((e.target as HTMLElement).closest("button")) return;

      const cell = cellRefs.current[col];
      if (!cell) return;

      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);

      const rect = cell.getBoundingClientRect();
      const pending: PendingDrag = {
        fromCol: col,
        widget,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
        width: rect.width,
        height: rect.height,
        colspan,
      };
      pendingRef.current = pending;
      setTrackPointer(true);
    },
    [isResizing],
  );

  const onSeamPointerDown = useCallback(
    (seam: PinSeam, e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0 || isDragging) return;

      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture?.(e.pointerId);

      pendingSeamRef.current = {
        seam,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
      };
      setTrackPointer(true);
    },
    [isDragging],
  );

  const seamPreviewAt = useCallback(
    (pending: PendingSeamResize | SeamResizeSession, clientX: number) => {
      const grid = gridRef.current;
      if (!grid) return null;
      return computeSeamResizePreview({
        seam: pending.seam,
        clientX,
        gridRect: grid.getBoundingClientRect(),
        gapPx: GRID_GAP_PX,
        layout: displayLayout,
      });
    },
    [displayLayout],
  );

  const beginSeamDrag = useCallback(
    (pending: PendingSeamResize, clientX: number) => {
      const preview = seamPreviewAt(pending, clientX);
      if (!preview) return;

      pendingSeamRef.current = null;
      const session: SeamResizeSession = {
        ...pending,
        preview,
      };
      seamRef.current = session;
      setSeamResize(session);
      document.body.classList.add("pin-desktop-body-resizing");
    },
    [seamPreviewAt],
  );

  const updateSeamPointer = useCallback(
    (clientX: number) => {
      const session = seamRef.current;
      if (!session) return;

      const preview = seamPreviewAt(session, clientX);
      if (!preview) return;

      const next = { ...session, preview };
      seamRef.current = next;
      setSeamResize(next);
    },
    [seamPreviewAt],
  );

  const endSeamResize = useCallback(
    (session: SeamResizeSession | null, moved: boolean, clientX?: number) => {
      pendingSeamRef.current = null;
      seamRef.current = null;
      setSeamResize(null);
      document.body.classList.remove("pin-desktop-body-resizing");
      if (session && moved && onSeamCommit) {
        // 卡片大小以鼠标松开位置为准：拖动过程中曾经经过某个档位，
        // 不应当使它在回拉后仍被意外提交。
        const preview =
          clientX != null ? seamPreviewAt(session, clientX) : session.preview;
        if (preview) onSeamCommit(session.seam, preview);
      }
    },
    [onSeamCommit, seamPreviewAt],
  );

  useEffect(() => {
    if (!trackPointer) return;

    const onMove = (e: PointerEvent) => {
      const pending = pendingRef.current;
      const activeDrag = dragRef.current;
      const activeSeam = seamRef.current;

      if (activeSeam && e.pointerId === activeSeam.pointerId) {
        e.preventDefault();
        updateSeamPointer(e.clientX);
        return;
      }

      const pendingSeam = pendingSeamRef.current;
      if (
        pendingSeam &&
        e.pointerId === pendingSeam.pointerId &&
        !seamRef.current
      ) {
        const dx = e.clientX - pendingSeam.startX;
        const dy = e.clientY - pendingSeam.startY;
        if (Math.hypot(dx, dy) < PIN_DRAG_MOVE_THRESHOLD) return;
        e.preventDefault();
        beginSeamDrag(pendingSeam, e.clientX);
        updateSeamPointer(e.clientX);
        return;
      }

      if (activeDrag && e.pointerId === activeDrag.pointerId) {
        e.preventDefault();
        updateDragPointer(e.clientX, e.clientY);
        return;
      }

      if (!pending || e.pointerId !== pending.pointerId || dragRef.current || seamRef.current) {
        return;
      }

      const dx = e.clientX - pending.startX;
      const dy = e.clientY - pending.startY;
      if (Math.hypot(dx, dy) < PIN_DRAG_MOVE_THRESHOLD) return;

      beginDrag(pending, e.clientX, e.clientY);
      updateDragPointer(e.clientX, e.clientY);
    };

    const onUp = (e: PointerEvent) => {
      const pendingSeam = pendingSeamRef.current;
      if (pendingSeam?.pointerId === e.pointerId) {
        pendingSeamRef.current = null;
        setTrackPointer(false);
        return;
      }
      if (seamRef.current?.pointerId === e.pointerId) {
        const session = seamRef.current;
        const moved =
          Math.hypot(e.clientX - session.startX, e.clientY - session.startY) >=
          PIN_DRAG_MOVE_THRESHOLD;
        endSeamResize(session, moved, e.clientX);
        setTrackPointer(false);
        return;
      }
      if (dragRef.current?.pointerId === e.pointerId) {
        endDrag(dragRef.current);
        return;
      }
      if (pendingRef.current?.pointerId === e.pointerId) {
        pendingRef.current = null;
        setTrackPointer(false);
      }
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [trackPointer, beginDrag, beginSeamDrag, endDrag, endSeamResize, updateDragPointer, updateSeamPointer]);

  useEffect(() => {
    if (!drag || drag.overCol == null || drag.overZone !== "replace") return;
    const id = window.setTimeout(() => {
      const session = dragRef.current;
      if (!session || session.overCol !== drag.overCol) return;
      updateDragPointer(session.x, session.y);
    }, PIN_DROP_ZONE_DWELL_MS + 1);
    return () => window.clearTimeout(id);
  }, [drag?.overCol, drag?.overZone, updateDragPointer]);

  useEffect(() => {
    return () => {
      document.body.classList.remove("pin-desktop-body-dragging");
      document.body.classList.remove("pin-desktop-body-resizing");
    };
  }, []);

  const placeholderCol = drag?.fromCol ?? null;
  const dropCol =
    drag &&
    drag.overCol != null &&
    (drag.overCol !== drag.fromCol ||
      (drag.overZone != null && drag.overZone !== "replace"))
      ? drag.overCol
      : null;
  const dropZone = drag?.overZone ?? null;

  const dockDropCol =
    dockDragWidget != null && dockDragOverCol != null ? dockDragOverCol : null;
  const dockDropZone = dockDragOverZone;

  const extensionCols = useMemo(() => {
    if (!onPinWidgetAtCol || !onAddTemplateAtCol || !isDockWidgetPinned) return [];
    const fillAllEmpty = pageCount > 1 && pageIndex < pageCount - 1;
    const slotLayout =
      seamResize != null ? layoutForExtensionSlots : normalizeLayout(displayLayout);
    const raw = extensionSlotColumns(slotLayout, { fillAllEmpty });
    const occupied = new Set<number>();
    for (const layout of [
      normalizeLayout(displayLayout),
      seamResize != null ? normalizeLayout(layoutForExtensionSlots) : null,
    ]) {
      if (!layout) continue;
      for (const seg of buildPinSegments(layout)) {
        if (seg.kind !== "widget") continue;
        for (let c = seg.col; c < seg.col + seg.colspan; c++) occupied.add(c);
      }
    }
    return raw.filter((col) => !occupied.has(col));
  }, [
    layoutForExtensionSlots,
    isDockWidgetPinned,
    onAddTemplateAtCol,
    onPinWidgetAtCol,
    pageCount,
    pageIndex,
  ]);

  const renderExtensionSlotCell = (col: number) => {
    if (!onPinWidgetAtCol || !onAddTemplateAtCol || !isDockWidgetPinned) return null;
    if (
      buildPinSegments(layoutForExtensionSlots).some(
        (seg) => seg.kind === "widget" && col >= seg.col && col < seg.col + seg.colspan,
      )
    ) {
      return null;
    }
    const isDropTarget = dropCol === col;
    const isDockDropTarget = dockDropCol === col;
    const activeZone =
      isDropTarget && dropZone
        ? dropZone
        : isDockDropTarget && dockDropZone
          ? dockDropZone
          : null;

    return (
      <div
        key={`extension-slot-${col}`}
        ref={(el) => {
          cellRefs.current[col] = el;
        }}
        className={`pin-desktop-cell pin-desktop-cell-extension${isDropTarget || isDockDropTarget ? " drop-target" : ""}`}
        style={{ gridColumn: `${col + 1} / span 1` }}
      >
        {activeZone ? renderDropZoneHints(activeZone, `zones-ext-${col}`) : null}
        <PinExtensionCard
          col={col}
          onPinWidget={onPinWidgetAtCol}
          onAddTemplate={onAddTemplateAtCol}
          isWidgetPinned={isDockWidgetPinned}
        />
      </div>
    );
  };

  const renderDropOverlay = (col: number, key: string) => {
    if (!gridBox) return null;
    const { colWidth, colStart } = columnGeometry(gridBox, GRID_GAP_PX);
    const left = colStart(col) - gridBox.left;
    return (
      <div
        key={key}
        className="pin-desktop-drop-overlay"
        style={{
          left: `${left}px`,
          width: `${colWidth}px`,
        }}
        aria-hidden
      />
    );
  };

  const renderDropZoneHints = (zone: PinDropZone, key: string) => (
    <div key={key} className="pin-desktop-drop-zones" aria-hidden>
      <div
        className={`pin-desktop-drop-zone pin-desktop-drop-zone-top${zone === "stack-above" ? " active" : ""}`}
      />
      <div
        className={`pin-desktop-drop-zone pin-desktop-drop-zone-middle${zone === "replace" ? " active" : ""}`}
      />
      <div
        className={`pin-desktop-drop-zone pin-desktop-drop-zone-bottom${zone === "stack-below" ? " active" : ""}`}
      />
    </div>
  );

  const renderStackHalfPlaceholder = (row: PinStackRow, key: string) => (
    <div
      key={key}
      className={`pin-desktop-stack-half pin-desktop-stack-placeholder pin-desktop-stack-row-${row}`}
      aria-hidden
    >
      <div className="pin-desktop-placeholder-inner" />
    </div>
  );

  const renderStackHalf = (
    widget: PinWidgetId,
    col: number,
    row: PinStackRow,
  ) => {
    const isDragged = drag?.widget === widget;
    if (isDragged) {
      if (placeholderCol === col) {
        return renderStackHalfPlaceholder(row, `ph-${widget}-${col}-${row}`);
      }
      return null;
    }

    return (
      <div
        key={`stack-half-${widget}-${col}-${row}`}
        className={`pin-desktop-stack-half pin-desktop-stack-row-${row}`}
      >
        <FlexibleWidgetFrame
          title={slotLabel(widget)}
          pinnable
          pinned
          onPinChange={() => onUnpin(widget)}
          dragHandle
          onHeaderPointerDown={(e) => onHeaderPointerDown(col, widget, 1, e)}
        >
          {widgets[widget] ?? <p className="empty-hint">面板加载中…</p>}
        </FlexibleWidgetFrame>
      </div>
    );
  };

  const renderStackCell = (col: number, top: PinWidgetId, bottom: PinWidgetId) => {
    const isDropTarget = dropCol === col;
    const isDockDropTarget = dockDropCol === col;
    const activeZone =
      isDropTarget && dropZone
        ? dropZone
        : isDockDropTarget && dockDropZone
          ? dockDropZone
          : null;

    return (
      <div
        key={`stack-${col}`}
        ref={(el) => {
          cellRefs.current[col] = el;
        }}
        className={`pin-desktop-cell pin-desktop-cell-stack${isDropTarget || isDockDropTarget ? " drop-target" : ""}`}
        style={{ gridColumn: `${col + 1} / span 1` }}
      >
        {activeZone ? renderDropZoneHints(activeZone, `zones-stack-${col}`) : null}
        {renderStackHalf(top, col, "top")}
        {renderStackHalf(bottom, col, "bottom")}
      </div>
    );
  };

  const renderWidgetCell = (
    widget: PinWidgetId,
    col: number,
    colspan: 1 | 2 | 3,
    storedSpan: 1 | 2 | 3,
  ) => {
    const isDragged = drag?.widget === widget;
    const isDropTarget = dropCol === col;
    const isDockDropTarget = dockDropCol === col;
    const activeZone =
      isDropTarget && dropZone
        ? dropZone
        : isDockDropTarget && dockDropZone
          ? dockDropZone
          : null;
    const targetOccupied = normLayout.cols[col] != null;

    if (isDragged) {
      if (placeholderCol === col) {
        return renderPlaceholder(col, colspan, `ph-${widget}-${col}`);
      }
      return null;
    }

    const resizeStyle = getResizeStyle(widget, col, storedSpan);
    const resizing =
      seamResize != null && seamAffectsWidget(seamResize.seam, widget) != null;
    const isWide = storedSpan >= 2;

    return (
      <div
        key={`widget-${widget}-${col}`}
        ref={(el) => {
          cellRefs.current[col] = el;
        }}
        className={`pin-desktop-cell pin-desktop-cell-widget${isWide && !resizing ? " wide" : ""}${storedSpan === 3 && !resizing ? " wide-3" : ""}${isDropTarget || isDockDropTarget ? " drop-target" : ""}${resizing ? " pin-desktop-cell-resizing" : ""}${resizing && isWide ? " pin-desktop-cell-resizing-wide" : ""}`}
        style={resizeStyle}
      >
        {activeZone && targetOccupied && storedSpan === 1
          ? renderDropZoneHints(activeZone, `zones-${col}-${widget}`)
          : null}
        <FlexibleWidgetFrame
          title={slotLabel(widget)}
          pinnable
          pinned
          onPinChange={() => onUnpin(widget)}
          dragHandle
          onHeaderPointerDown={(e) => onHeaderPointerDown(col, widget, colspan, e)}
        >
          {widgets[widget] ?? <p className="empty-hint">面板加载中…</p>}
        </FlexibleWidgetFrame>
      </div>
    );
  };

  const renderPlaceholder = (col: number, colspan: 1 | 2 | 3, key: string) => (
    <div
      key={key}
      className="pin-desktop-cell pin-desktop-cell-placeholder"
      style={{ gridColumn: `${col + 1} / span ${colspan}` }}
      aria-hidden
    >
      <div className="pin-desktop-placeholder-inner" />
    </div>
  );

  const getResizeStyle = (
    widget: PinWidgetId,
    col: number,
    storedSpan: 1 | 2 | 3,
  ): CSSProperties => {
    if (!seamResize) return { gridColumn: `${col + 1} / span ${storedSpan}` };

    const role = seamAffectsWidget(seamResize.seam, widget);
    if (!role) return { gridColumn: `${col + 1} / span ${storedSpan}` };

    const { preview, seam } = seamResize;
    const base: CSSProperties = {
      justifySelf: "start",
      transition: "none",
    };

    const cellStartForCol = (anchorCol: number) => {
      if (!gridBox) return preview.pairLeft;
      return columnGeometry(gridBox, GRID_GAP_PX).colStart(anchorCol);
    };

    if (role === "left") {
      if (preview.consumeLeft) {
        return {
          ...base,
          gridColumn: `${col + 1} / span 1`,
          opacity: 0,
          pointerEvents: "none",
          width: 0,
          overflow: "hidden",
        };
      }
      const anchorCol = col !== seam.leftCol ? col : seam.leftCol;
      const cellStart = cellStartForCol(anchorCol);
      const width = Math.max(0, preview.boundaryX - cellStartForCol(seam.leftCol));
      if (width <= 1) {
        return {
          ...base,
          gridColumn: `${col + 1} / span 1`,
          opacity: 0,
          pointerEvents: "none",
          width: 0,
          overflow: "hidden",
        };
      }
      const pairRight = preview.pairLeft + preview.pairTotal;
      const marginLeft =
        anchorCol !== seam.leftCol ? pairRight - width - cellStart : 0;
      return {
        ...base,
        gridColumn: `${anchorCol + 1} / span ${storedSpan}`,
        width: `${width}px`,
        marginLeft: `${marginLeft}px`,
        zIndex: 3,
      };
    }

    if (preview.consumeRight) {
      return {
        ...base,
        gridColumn: `${col + 1} / span 1`,
        opacity: 0,
        pointerEvents: "none",
        width: 0,
        overflow: "hidden",
      };
    }

    const { rightCol } = seamVisualCellCols(seam, displayLayout);
    const anchorCol = rightCol ?? col;
    const cellStart = cellStartForCol(anchorCol);
    const spanCols = storedSpan;
    const spanEnd =
      cellStart +
      spanCols * preview.oneWidth +
      (spanCols > 1 ? preview.gapPx * (spanCols - 1) : 0);
    const width = Math.max(0, spanEnd - preview.boundaryX);
    if (width <= 1) {
      return {
        ...base,
        gridColumn: `${col + 1} / span 1`,
        opacity: 0,
        pointerEvents: "none",
        width: 0,
        overflow: "hidden",
      };
    }
    const marginLeft = preview.boundaryX - cellStart;

    return {
      ...base,
      gridColumn: `${anchorCol + 1} / span ${spanCols}`,
      width: `${width}px`,
      marginLeft: `${marginLeft}px`,
      zIndex: 2,
    };
  };

  const renderWidgetFrame = (widget: PinWidgetId, opts?: { floating?: boolean }) => {
    return (
      <FlexibleWidgetFrame
        title={slotLabel(widget)}
        pinnable={!opts?.floating}
        pinned
        onPinChange={opts?.floating ? undefined : () => onUnpin(widget)}
      >
        {widgets[widget] ?? <p className="empty-hint">面板加载中…</p>}
      </FlexibleWidgetFrame>
    );
  };

  const renderSeamDividers = () => {
    if (!gridBox || isDragging) return null;

    return seams.map((seam) => {
      // 拖拽挤压时只显示当前接缝，避免宽卡右缘接缝在邻卡缩没时闪到列中线
      if (isResizing && seamResize?.seam.boundary !== seam.boundary) return null;

      const { leftCol, rightCol } = seamVisualCellCols(seam, displayLayout);
      const leftCell = leftCol != null ? cellRefs.current[leftCol]?.getBoundingClientRect() : null;
      const rightCell =
        rightCol != null ? cellRefs.current[rightCol]?.getBoundingClientRect() : null;

      if (!isSeamVisuallyPlaced(seam, displayLayout, leftCell, rightCell)) return null;

      const overrideX =
        seamResize?.seam.boundary === seam.boundary
          ? seamResize.preview.boundaryX
          : undefined;

      const leftPx = seamLineLeftPx({
        seam,
        layout: displayLayout,
        gridRect: gridBox,
        gapPx: GRID_GAP_PX,
        leftCell,
        rightCell,
        overrideX,
      });

      const resizingThis = seamResize?.seam.boundary === seam.boundary;

      return (
        <div
          key={`seam-${seam.boundary}-${seam.leftWidget}`}
          className={`pin-desktop-seam${resizingThis ? " active" : ""}`}
          role="separator"
          aria-orientation="vertical"
          aria-label={`调整${slotLabel(seam.leftWidget)}宽度`}
          style={{ left: `${leftPx}px` }}
          onPointerDown={(e) => onSeamPointerDown(seam, e)}
        />
      );
    });
  };

  return (
    <>
      <div
        ref={gridRef}
        className={`pin-desktop-grid pin-desktop-grid-logical${isDragging ? " pin-desktop-dragging" : ""}${isResizing ? " pin-desktop-resizing" : ""}${dockDragWidget ? " pin-desktop-dock-dragging" : ""}`}
        style={{ gridTemplateColumns }}
        aria-label="柔性桌面三列任务栏"
      >
        {pinnedCount === 0 && !dockDragWidget && extensionCols.length === 0 ? (
          <div className="pin-desktop-grid-hint" aria-hidden>
            <p>拖底栏图标到槽位 · 拖标题栏换位 · 拖接缝跟手改宽</p>
          </div>
        ) : null}

        {displaySegments.map((seg) => {
          if (seg.kind === "stack") {
            return renderStackCell(seg.col, seg.top, seg.bottom);
          }
          if (seg.kind !== "widget") return null;
          return renderWidgetCell(seg.widget, seg.col, seg.colspan, seg.colspan);
        })}

        {extensionCols.map((col) => renderExtensionSlotCell(col))}

        {isDragging && placeholderCol != null && !displaySegments.some(
          (s) =>
            (s.kind === "widget" || s.kind === "stack") && s.col === placeholderCol,
        )
          ? renderPlaceholder(placeholderCol, drag!.colspan, `ph-floating-${placeholderCol}`)
          : null}

        {isDragging && dropCol != null && normLayout.cols[dropCol] == null
          ? renderDropOverlay(dropCol, `drop-overlay-${dropCol}`)
          : null}

        {dockDragWidget != null &&
        dockDropCol != null &&
        normLayout.cols[dockDropCol] == null
          ? renderDropOverlay(dockDropCol, `dock-drop-overlay-${dockDropCol}`)
          : null}

        {renderSeamDividers()}

      </div>

      {drag &&
        createPortal(
          <div
            ref={overlayRef}
            className="pin-drag-overlay"
            style={{
              width: drag.width,
              height: drag.height,
            }}
          >
            {renderWidgetFrame(drag.widget, { floating: true })}
          </div>,
          document.body,
        )}
    </>
  );
}
