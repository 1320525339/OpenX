/** 开发环境直连后端，避免 Vite 代理破坏 SSE（chunked encoding）与长耗时 pick 请求 */
export function getApiBase(): string {
  if (typeof window !== "undefined" && window.location.port === "5173") {
    return "http://127.0.0.1:3921";
  }
  return "";
}
