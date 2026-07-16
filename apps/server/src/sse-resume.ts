/**
 * 解析浏览器 Last-Event-ID。
 * `0` / 非法值视为首次连接（兼容历史 connected 事件曾写入 id=0 污染游标）。
 */
export function parseSseLastEventId(header: string | undefined): number | undefined {
  if (header == null || header.trim() === "") return undefined;
  const parsed = Number.parseInt(header, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return undefined;
  return parsed;
}
