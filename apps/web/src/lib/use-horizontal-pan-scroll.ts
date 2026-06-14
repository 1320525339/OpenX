import { useEffect, useRef, useState } from "react";

/** 横向可滚动区域：鼠标中键拖拽 + 滚轮横向滑动 */
export function useHorizontalPanScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const canScroll = () => el.scrollWidth > el.clientWidth + 1;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 1 || !canScroll()) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startScroll = el.scrollLeft;
      setPanning(true);

      const onMove = (ev: MouseEvent) => {
        ev.preventDefault();
        el.scrollLeft = startScroll - (ev.clientX - startX);
      };

      const onUp = () => {
        setPanning(false);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    };

    const onWheel = (e: WheelEvent) => {
      if (!canScroll()) return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      e.preventDefault();
      el.scrollLeft += delta;
    };

    el.addEventListener("mousedown", onMouseDown, { capture: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("mousedown", onMouseDown, { capture: true });
      el.removeEventListener("wheel", onWheel);
    };
  }, []);

  return { ref, panning };
}
