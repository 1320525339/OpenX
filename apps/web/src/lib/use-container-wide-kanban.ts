import { useEffect, useState } from "react";

const DEFAULT_MIN_WIDTH = 720;

/** 按看板容器宽度（非窗口）决定宽列 / Tab 模式 */
export function useContainerWideKanban(
  element: HTMLElement | null,
  minWidth = DEFAULT_MIN_WIDTH,
): boolean {
  const [wide, setWide] = useState(false);

  useEffect(() => {
    if (!element || typeof ResizeObserver === "undefined") {
      setWide(false);
      return;
    }

    const sync = (width: number) => setWide(width >= minWidth);
    sync(element.getBoundingClientRect().width);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      sync(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, minWidth]);

  return wide;
}
