import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "openx.sidebar.open";

function loadSidebarOpen(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "0") return false;
    if (raw === "1") return true;
  } catch {
    /* ignore */
  }
  return true;
}

/** Cursor 式侧栏：点击 / Ctrl+B 切换，状态持久化 */
export function useSidebar() {
  const [sidebarOpen, setSidebarOpen] = useState(loadSidebarOpen);

  const setOpen = useCallback((open: boolean) => {
    setSidebarOpen(open);
    try {
      localStorage.setItem(STORAGE_KEY, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const toggleSidebar = useCallback(() => {
    setOpen(!sidebarOpen);
  }, [setOpen, sidebarOpen]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== "b") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }
      e.preventDefault();
      toggleSidebar();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleSidebar]);

  return {
    sidebarOpen,
    toggleSidebar,
    openSidebar: () => setOpen(true),
    closeSidebar: () => setOpen(false),
  };
}
