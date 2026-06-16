/** 将屏幕坐标映射到 CDP 视口坐标（object-fit: contain 含 letterbox） */
export function mapScreencastClick(
  el: HTMLElement,
  clientX: number,
  clientY: number,
  viewportW: number,
  viewportH: number,
): { x: number; y: number } | null {
  if (viewportW <= 0 || viewportH <= 0) return null;

  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const contentAspect = viewportW / viewportH;
  const elementAspect = rect.width / rect.height;

  let renderW = rect.width;
  let renderH = rect.height;
  let offsetX = 0;
  let offsetY = 0;

  if (contentAspect > elementAspect) {
    renderH = rect.width / contentAspect;
    offsetY = (rect.height - renderH) / 2;
  } else if (contentAspect < elementAspect) {
    renderW = rect.height * contentAspect;
    offsetX = (rect.width - renderW) / 2;
  }

  const relX = (clientX - rect.left - offsetX) / renderW;
  const relY = (clientY - rect.top - offsetY) / renderH;
  if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return null;

  return {
    x: Math.min(viewportW - 1, Math.max(0, Math.round(relX * viewportW))),
    y: Math.min(viewportH - 1, Math.max(0, Math.round(relY * viewportH))),
  };
}

/** 保留 API；布局改由 CSS object-fit: contain 填满 stage */
export function fitBrowserFrame(
  _stage: HTMLElement,
  el: HTMLElement,
  _viewportW: number,
  _viewportH: number,
): void {
  el.style.width = "100%";
  el.style.height = "100%";
  el.style.objectFit = "contain";
}

export const BROWSER_VIEWPORT = { width: 1280, height: 720 } as const;
