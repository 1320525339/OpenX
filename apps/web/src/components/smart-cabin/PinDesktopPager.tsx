import {
  useCallback,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

const SWIPE_THRESHOLD_PX = 52;

type Props = {
  pageIndex: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  children: ReactNode;
};

export function PinDesktopPager({ pageIndex, pageCount, onPageChange, children }: Props) {
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const [enterDir, setEnterDir] = useState<"left" | "right" | null>(null);

  const cycle = useCallback(
    (delta: 1 | -1) => {
      if (pageCount <= 1) return;
      setEnterDir(delta > 0 ? "left" : "right");
      onPageChange((pageIndex + delta + pageCount) % pageCount);
    },
    [onPageChange, pageCount, pageIndex],
  );

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || pageCount <= 1) return;
    if ((e.target as HTMLElement).closest(".pin-desktop-seam, .pin-desktop-edge-handle, .flexible-widget-head, .pin-extension-add-trigger, .pin-extension-add-menu, .pin-extension-cell, .oxsp-browser-screencast-wrap, .oxsp-browser-url-input")) {
      return;
    }
    startRef.current = { x: e.clientX, y: e.clientY };
  }, [pageCount]);

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const start = startRef.current;
      startRef.current = null;
      if (!start || pageCount <= 1) return;

      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.15) return;

      if (dx < 0) cycle(1);
      else cycle(-1);
    },
    [cycle, pageCount],
  );

  const onPointerCancel = useCallback(() => {
    startRef.current = null;
  }, []);

  return (
    <div
      className="pin-desktop-pager"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div
        key={pageIndex}
        className={`pin-desktop-pager-slide${enterDir ? ` pin-desktop-pager-slide-from-${enterDir}` : ""}`}
        onAnimationEnd={() => setEnterDir(null)}
      >
        {children}
      </div>

      {pageCount > 1 ? (
        <div className="pin-desktop-page-dots" role="tablist" aria-label="桌面分页">
          {Array.from({ length: pageCount }, (_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === pageIndex}
              aria-label={`第 ${i + 1} 页`}
              className={`pin-desktop-page-dot${i === pageIndex ? " active" : ""}`}
              onClick={() => onPageChange(i)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
