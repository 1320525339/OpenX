import { useEffect, useState } from "react";
import {
  desktopQuit,
  getDesktopPrefs,
  setDesktopPrefs,
  type DesktopPrefs,
} from "../lib/desktop-bridge";
import { detectLowMemoryDevice } from "../lib/use-desktop-prefs";
import { isTauri } from "../lib/is-tauri";

export function DesktopSettingsSection() {
  const [prefs, setPrefs] = useState<DesktopPrefs | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    void getDesktopPrefs().then(setPrefs);
  }, []);

  if (!isTauri()) return null;
  if (!prefs) {
    return <p className="settings-hint">加载桌面偏好…</p>;
  }

  const save = async (next: DesktopPrefs) => {
    setPrefs(next);
    setSaving(true);
    try {
      await setDesktopPrefs(next);
      document.documentElement.dataset.lowMemory = next.lowMemoryMode ? "true" : "false";
    } finally {
      setSaving(false);
    }
  };

  const suggestLowMemory = detectLowMemoryDevice();
  const heapMb =
    typeof performance !== "undefined" &&
    "memory" in performance &&
    (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
      ? Math.round(
          (performance as Performance & { memory: { usedJSHeapSize: number } }).memory
            .usedJSHeapSize /
            1024 /
            1024,
        )
      : null;

  return (
    <section className="settings-section desktop-settings-block">
      <h4 className="settings-section-title">桌面客户端</h4>
      <label className="mech-switch">
        <span>关闭窗口时最小化到托盘</span>
        <input
          type="checkbox"
          checked={prefs.closeToTray}
          onChange={(e) => void save({ ...prefs, closeToTray: e.target.checked })}
        />
      </label>
      <label className="mech-switch">
        <span>启动时最小化到托盘</span>
        <input
          type="checkbox"
          checked={prefs.startMinimized}
          onChange={(e) => void save({ ...prefs, startMinimized: e.target.checked })}
        />
      </label>
      <label className="mech-switch">
        <span>低内存模式（简化动画与预热）</span>
        <input
          type="checkbox"
          checked={prefs.lowMemoryMode}
          onChange={(e) => void save({ ...prefs, lowMemoryMode: e.target.checked })}
        />
      </label>
      {suggestLowMemory && !prefs.lowMemoryMode ? (
        <p className="desktop-memory-hint">检测到设备内存较低，建议开启低内存模式。</p>
      ) : null}
      {heapMb != null ? (
        <p className="desktop-memory-hint">当前页面 JS 堆内存约 {heapMb} MB（仅 Chromium 可用）。</p>
      ) : null}
      <button
        type="button"
        className="btn danger"
        disabled={saving}
        onClick={() => void desktopQuit()}
      >
        退出 OpenX
      </button>
    </section>
  );
}
