import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

function loadRatio(
  storageKey: string,
  defaultRatio: number,
  minRatio: number,
  maxRatio: number,
): number {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return defaultRatio;
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) return defaultRatio;
    return Math.min(maxRatio, Math.max(minRatio, n));
  } catch {
    return defaultRatio;
  }
}

function loadWidth(storageKey: string, defaultPx: number, minPx: number, maxPx: number): number {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return defaultPx;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return defaultPx;
    return Math.min(maxPx, Math.max(minPx, n));
  } catch {
    return defaultPx;
  }
}

type RatioOptions = {
  mode?: "ratio";
  orientation?: "horizontal" | "vertical";
  storageKey: string;
  defaultRatio: number;
  minRatio?: number;
  maxRatio?: number;
};

type WidthOptions = {
  mode: "width";
  storageKey: string;
  defaultWidth: number;
  minWidth?: number;
  maxWidth?: number;
};

export type PaneResizeOptions = RatioOptions | WidthOptions;

export function usePaneResize(options: PaneResizeOptions) {
  const isWidth = options.mode === "width";
  const isVertical = !isWidth && options.orientation === "vertical";
  const min = isWidth ? (options.minWidth ?? 132) : (options.minRatio ?? 0.15);
  const max = isWidth ? (options.maxWidth ?? 320) : (options.maxRatio ?? 0.85);

  const [value, setValue] = useState(() =>
    isWidth
      ? loadWidth(options.storageKey, options.defaultWidth, min, max)
      : loadRatio(options.storageKey, options.defaultRatio, min, max),
  );
  const valueRef = useRef(value);
  const draggingRef = useRef(false);
  const dragContainerRef = useRef<HTMLElement | null>(null);
  const windowCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (options.mode === "width") {
      const next = loadWidth(options.storageKey, options.defaultWidth, min, max);
      valueRef.current = next;
      setValue(next);
      return;
    }
    const next = loadRatio(options.storageKey, options.defaultRatio, min, max);
    valueRef.current = next;
    setValue(next);
  }, [
    options.mode,
    options.storageKey,
    options.mode === "width" ? options.defaultWidth : options.defaultRatio,
    min,
    max,
  ]);

  const cleanupWindowDrag = useCallback(() => {
    windowCleanupRef.current?.();
    windowCleanupRef.current = null;
  }, []);

  const clearDragState = useCallback(() => {
    draggingRef.current = false;
    dragContainerRef.current = null;
    document.body.classList.remove(
      "split-dragging",
      "split-dragging-rows",
      "split-dragging-cols",
    );
    cleanupWindowDrag();
  }, [cleanupWindowDrag]);

  const persist = useCallback(() => {
    try {
      localStorage.setItem(options.storageKey, String(valueRef.current));
    } catch {
      /* ignore */
    }
  }, [options.storageKey]);

  const updateFromPointer = useCallback(
    (clientPos: number, container: HTMLElement | null) => {
      if (!draggingRef.current || !container) return;
      const rect = container.getBoundingClientRect();
      if (isVertical) {
        if (rect.height <= 0) return;
        const next = Math.min(max, Math.max(min, (clientPos - rect.top) / rect.height));
        valueRef.current = next;
        setValue(next);
        return;
      }
      if (rect.width <= 0) return;
      if (isWidth) {
        const next = Math.min(max, Math.max(min, clientPos - rect.left));
        valueRef.current = next;
        setValue(next);
        return;
      }
      const next = Math.min(max, Math.max(min, (clientPos - rect.left) / rect.width));
      valueRef.current = next;
      setValue(next);
    },
    [isWidth, isVertical, min, max],
  );

  const beginDrag = useCallback(
    (e: ReactPointerEvent<HTMLElement>, container: HTMLElement | null = null) => {
      e.preventDefault();
      draggingRef.current = true;
      dragContainerRef.current = container;
      e.currentTarget.setPointerCapture(e.pointerId);
      document.body.classList.add(
        "split-dragging",
        isVertical ? "split-dragging-rows" : "split-dragging-cols",
      );

      const onWindowPointerMove = (ev: PointerEvent) => {
        if (!draggingRef.current) return;
        updateFromPointer(
          isVertical ? ev.clientY : ev.clientX,
          dragContainerRef.current,
        );
      };

      const onWindowPointerUp = () => {
        if (!draggingRef.current) return;
        clearDragState();
        persist();
      };

      window.addEventListener("pointermove", onWindowPointerMove);
      window.addEventListener("pointerup", onWindowPointerUp);
      windowCleanupRef.current = () => {
        window.removeEventListener("pointermove", onWindowPointerMove);
        window.removeEventListener("pointerup", onWindowPointerUp);
      };
    },
    [isVertical, updateFromPointer, persist, clearDragState],
  );

  const onDividerPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>, container: HTMLElement | null) => {
      updateFromPointer(isVertical ? e.clientY : e.clientX, container);
    },
    [updateFromPointer, isVertical],
  );

  const endDrag = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!draggingRef.current) return;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      clearDragState();
      persist();
    },
    [persist, clearDragState],
  );

  const nudgeRatio = useCallback(
    (delta: number) => {
      if (isWidth) return;
      const next = Math.min(max, Math.max(min, valueRef.current + delta));
      valueRef.current = next;
      setValue(next);
      persist();
    },
    [isWidth, min, max, persist],
  );

  return {
    value,
    valueRef,
    isWidth,
    isVertical,
    setValue,
    beginDrag,
    onDividerPointerMove,
    endDrag,
    nudgeRatio,
    persist,
  };
}
