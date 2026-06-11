/** 判断内容是否以 HTML 块为主（可安全走 rehype-raw 管道） */
export function isHtmlHeavyContent(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^<!DOCTYPE\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
    return true;
  }
  if (/^<(?:div|p|section|article|table|ul|ol|h[1-6]|blockquote|pre|details)\b/i.test(trimmed)) {
    return true;
  }
  return /<(strong|em|b|i|a|code|span|br)\b[^>]*>/i.test(trimmed) && !/^#{1,6}\s/m.test(trimmed);
}

/** 流式输出中不解析 Markdown，避免半截语法闪烁 */
export function shouldDeferRichRender(streaming: boolean): boolean {
  return streaming;
}
