const SERVER_URL = "http://127.0.0.1:3921";

/** 前端与 API 分离、需直连 sidecar :3921 的客户端（Vite dev / Tauri 桌面包） */
export function usesDirectServerApi(): boolean {
  if (typeof window === "undefined") return false;
  if (window.location.port === "5173") return true;
  if ("__TAURI__" in window) return true;
  if (window.location.protocol === "file:") return true;
  const host = window.location.hostname;
  if (host === "tauri.localhost" || host.endsWith(".tauri.localhost")) return true;
  return false;
}

/** 开发环境直连后端，避免 Vite 代理破坏 SSE（chunked encoding）与长耗时 pick 请求 */
export function getApiBase(): string {
  return usesDirectServerApi() ? SERVER_URL : "";
}

/** WebSocket 与 HTTP API 使用相同的后端地址策略 */
export function getWsBase(): string {
  if (usesDirectServerApi()) return "ws://127.0.0.1:3921";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}`;
}
