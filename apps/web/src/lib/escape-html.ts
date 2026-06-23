/** 无 DOM 依赖的 HTML 转义（供 diff 高亮加载前占位） */
export function escapeHtmlPlain(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
