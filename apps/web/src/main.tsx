import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/theme.css";
import "./styles/global.css";
import "./styles/scrollbars.css";
import "./styles/desktop-shell.css";
import { initTheme } from "./lib/theme";
import { isTauri } from "./lib/is-tauri";
import { useDesktopPrefs } from "./lib/use-desktop-prefs";

initTheme();
if (isTauri()) {
  document.documentElement.dataset.desktop = "true";
}

function DesktopPrefsBoot() {
  useDesktopPrefs();
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isTauri() ? <DesktopPrefsBoot /> : null}
    <App />
  </StrictMode>,
);
