/** 是否在 Tauri 桌面包内运行 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}
