import { useCallback, useRef, useState } from "react";

const CLOSE_DELAY_MS = 320;

/** 侧栏默认贴边隐藏，鼠标靠近左缘或进入侧栏时展开 */
export function useSidebarHover() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeTimerRef = useRef<number | undefined>(undefined);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
  }, []);

  const openSidebar = useCallback(() => {
    cancelClose();
    setSidebarOpen(true);
  }, [cancelClose]);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      setSidebarOpen(false);
      closeTimerRef.current = undefined;
    }, CLOSE_DELAY_MS);
  }, [cancelClose]);

  return {
    sidebarOpen,
    openSidebar,
    onEdgeEnter: openSidebar,
    onSidebarEnter: openSidebar,
    onSidebarLeave: scheduleClose,
  };
}
