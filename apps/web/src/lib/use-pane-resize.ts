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
  const min = isWidth ? (options.minWidth ?? 132) : (options.minRatio ?? 0.15);
  const max = isWidth ? (options.maxWidth ?? 320) : (options.maxRatio ?? 0.85);

  const [value, setValue] = useState(() =>
    isWidth
      ? loadWidth(options.storageKey, options.defaultWidth, min, max)
      : loadRatio(options.storageKey, options.defaultRatio, min, max),
  );
  const valueRef = useRef(value);
  const draggingRef = useRef(false);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const persist = useCallback(() => {
    try {
      localStorage.setItem(options.storageKey, String(valueRef.current));
    } catch {
      /* ignore */
    }
  }, [options.storageKey]);

  const beginDrag = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault();
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.classList.add("split-dragging");
  }, []);

  const updateFromPointer = useCallback(
    (clientX: number, container: HTMLElement | null) => {
      if (!draggingRef.current || !container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;
      if (isWidth) {
        const next = Math.min(max, Math.max(min, clientX - rect.left));
        valueRef.current = next;
        setValue(next);
        return;
      }
      const next = Math.min(max, Math.max(min, (clientX - rect.left) / rect.width));
      valueRef.current = next;
      setValue(next);
    },
    [isWidth, min, max],
  );

  const onDividerPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>, container: HTMLElement | null) => {
      updateFromPointer(e.clientX, container);
    },
    [updateFromPointer],
  );

  const endDrag = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.classList.remove("split-dragging");
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      persist();
    },
    [persist],
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
    setValue,
    beginDrag,
    onDividerPointerMove,
    endDrag,
    nudgeRatio,
    persist,
  };
}
