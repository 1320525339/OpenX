/** 全局递增任务单序号 → 展示用 WO-000042 */
export function formatWorkOrderId(orderNo: number): string {
  return `WO-${String(Math.max(0, Math.floor(orderNo))).padStart(6, "0")}`;
}

export function parseWorkOrderId(label: string): number | null {
  const m = /^WO-(\d+)$/i.exec(label.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}
