export type BrowserDevToolsTab = "network" | "dom" | "foreman";

export type OpenBrowserDevToolsDetail = {
  sessionId?: string;
  tab: BrowserDevToolsTab;
  scope?: "console" | "conversation";
};

export const OPENX_BROWSER_DEVTOOLS_EVENT = "openx-browser-devtools";

export function dispatchOpenBrowserDevTools(detail: OpenBrowserDevToolsDetail): void {
  window.dispatchEvent(new CustomEvent(OPENX_BROWSER_DEVTOOLS_EVENT, { detail }));
}
