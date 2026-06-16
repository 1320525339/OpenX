import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

const STORAGE_PREFIX = "openx.resize-from-top.";

function loadHeight(key: string | undefined, fallback: number): number {
  if (!key) return fallback;
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
    if (!raw) return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

type Options = {
  storageKey?: string;
  defaultHeight?: number;
  minHeight?: number;
  /** 动态计算最大高度（例如：上方剩余可视空间） */
  getMaxHeight?: () => number;
};

export function useResizeFromTop({
  storageKey,
  defaultHeight = 55,
  minHeight = 40,
  getMaxHeight,
}: Options = {}) {
  const [height, setHeight] = useState(() => loadHeight(storageKey, defaultHeight));
  const heightRef = useRef(height);

  useEffect(() => {
    heightRef.current = height;
  }, [height]);

  useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${storageKey}`, String(Math.round(height)));
    } catch {
      /* ignore */
    }
  }, [height, storageKey]);

  const onResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      event.preventDefault();
      const handle = event.currentTarget;
      const startY = event.clientY;
      const startHeight = heightRef.current;
      const maxHeight = Math.max(minHeight, getMaxHeight?.() ?? 320);

      handle.setPointerCapture(event.pointerId);

      const onMove = (ev: PointerEvent) => {
        const next = Math.min(
          maxHeight,
          Math.max(minHeight, startHeight + (startY - ev.clientY)),
        );
        setHeight(next);
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        try {
          handle.releasePointerCapture(event.pointerId);
        } catch {
          /* ignore */
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [getMaxHeight, minHeight],
  );

  return { height, setHeight, onResizePointerDown };
}
