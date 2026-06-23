import { useEffect } from "react";
import { getDesktopPrefs } from "./desktop-bridge";
import { isTauri } from "./is-tauri";

const LOW_MEMORY_RAM_GB = 4;

export function useDesktopPrefs() {
  useEffect(() => {
    if (!isTauri()) return;
    void getDesktopPrefs().then((prefs) => {
      document.documentElement.dataset.lowMemory = prefs.lowMemoryMode ? "true" : "false";
    });
  }, []);
}

/** 自动检测低内存设备（物理内存 ≤4GB 时建议开启低内存模式） */
export function detectLowMemoryDevice(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number };
  if (typeof nav.deviceMemory === "number" && nav.deviceMemory > 0) {
    return nav.deviceMemory <= LOW_MEMORY_RAM_GB;
  }
  return false;
}
