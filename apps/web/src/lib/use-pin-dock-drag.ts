import { useCallback, useEffect, useRef, useState } from "react";

import {
  createPinDropTargetTracker,
  PIN_DROP_ZONE_DWELL_MS,
  resolvePinDropColumn,
  type PinDropZone,
} from "./pin-desktop-drop";
import type { PinDesktopLayout, PinWidgetId } from "./pin-desktop";

const GRID_GAP_PX = 8;

export type PinDockDragState = {
  widget: PinWidgetId;
  overCol: number | null;
  overZone: PinDropZone | null;
};

export function usePinDockDrag(
  layout: PinDesktopLayout,
  placeAtDrop: (widget: PinWidgetId, toCol: number, zone: PinDropZone) => void,
  getCellRect?: () => (col: number) => DOMRect | null,
) {
  const gridRectRef = useRef<DOMRect | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  const dropTargetTrackerRef = useRef(createPinDropTargetTracker());
  const [dockDrag, setDockDrag] = useState<PinDockDragState | null>(null);

  const onGridRectChange = useCallback((rect: DOMRect) => {
    gridRectRef.current = rect;
  }, []);

  const resolveDockTarget = useCallback(
    (clientX: number, clientY: number) => {
      const gridRect = gridRectRef.current;
      if (!gridRect) return null;

      const col = resolvePinDropColumn({
        gridRect,
        clientX,
        layout,
        gapPx: GRID_GAP_PX,
        getCellRect: getCellRect?.(),
      });

      return dropTargetTrackerRef.current.resolve({
        gridRect,
        cellRect: getCellRect?.()(col) ?? null,
        clientX,
        clientY,
        layout,
        gapPx: GRID_GAP_PX,
        targetCol: col,
      });
    },
    [layout, getCellRect],
  );

  const onDockDragStart = useCallback((widget: PinWidgetId) => {
    dropTargetTrackerRef.current.reset();
    setDockDrag({ widget, overCol: null, overZone: null });
  }, []);

  const onDockDragMove = useCallback(
    (clientX: number, clientY: number) => {
      pointerRef.current = { x: clientX, y: clientY };
      const target = resolveDockTarget(clientX, clientY);
      if (!target) return;
      setDockDrag((prev) =>
        prev ? { ...prev, overCol: target.col, overZone: target.zone } : null,
      );
    },
    [resolveDockTarget],
  );

  const onDockDragEnd = useCallback(
    (widget: PinWidgetId, clientX: number, clientY: number) => {
      const target = resolveDockTarget(clientX, clientY);
      if (target) {
        placeAtDrop(widget, target.col, target.zone);
      }
      dropTargetTrackerRef.current.reset();
      setDockDrag(null);
    },
    [placeAtDrop, resolveDockTarget],
  );

  const onDockDragCancel = useCallback(() => {
    dropTargetTrackerRef.current.reset();
    setDockDrag(null);
  }, []);

  useEffect(() => {
    if (!dockDrag || dockDrag.overCol == null || dockDrag.overZone !== "replace") return;

    const id = window.setTimeout(() => {
      const { x, y } = pointerRef.current;
      const target = resolveDockTarget(x, y);
      if (!target) return;
      setDockDrag((prev) =>
        prev && (prev.overCol !== target.col || prev.overZone !== target.zone)
          ? { ...prev, overCol: target.col, overZone: target.zone }
          : prev,
      );
    }, PIN_DROP_ZONE_DWELL_MS + 1);
    return () => window.clearTimeout(id);
  }, [dockDrag?.overCol, dockDrag?.overZone, resolveDockTarget]);

  return {
    dockDrag,
    onGridRectChange,
    onDockDragStart,
    onDockDragMove,
    onDockDragEnd,
    onDockDragCancel,
  };
}
