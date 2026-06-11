import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/theme.css";
import "./styles/global.css";
import "./styles/scrollbars.css";
import { initTheme } from "./lib/theme";

initTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
