import { useEffect, useState } from "react";
import {
  closeWindow,
  isWindowMaximized,
  minimizeWindow,
  onWindowMaximizedChange,
  toggleMaximizeWindow,
} from "../lib/desktop-bridge";

export function DesktopTitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    void isWindowMaximized().then(setMaximized);
    return onWindowMaximizedChange(setMaximized);
  }, []);

  return (
    <header className="desktop-titlebar" data-tauri-drag-region>
      <div className="desktop-titlebar-leading" data-tauri-drag-region>
        <span className="desktop-titlebar-brand">OpenX</span>
      </div>
      <div className="desktop-titlebar-controls">
        <button
          type="button"
          className="desktop-titlebar-btn"
          aria-label="最小化"
          onClick={() => void minimizeWindow()}
        >
          <span aria-hidden>—</span>
        </button>
        <button
          type="button"
          className="desktop-titlebar-btn"
          aria-label={maximized ? "还原" : "最大化"}
          onClick={() => void toggleMaximizeWindow()}
        >
          <span aria-hidden>{maximized ? "❐" : "□"}</span>
        </button>
        <button
          type="button"
          className="desktop-titlebar-btn desktop-titlebar-btn-close"
          aria-label="关闭"
          onClick={() => void closeWindow()}
        >
          <span aria-hidden>×</span>
        </button>
      </div>
    </header>
  );
}
