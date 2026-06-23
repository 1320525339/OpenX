import type { ToolRunRow } from "./run-tool-rows";

export type ToolDisplayItem =
  | { kind: "tool"; row: ToolRunRow }
  | { kind: "readonly-batch"; rows: ToolRunRow[]; label: string };

function isBatchable(row: ToolRunRow): boolean {
  return Boolean(row.readOnly) && !row.running && !row.isError;
}

/** 连续只读且已完成的工具合并为一批（Reasonix ReadOnlyBatch 思路） */
export function groupToolDisplayItems(rows: ToolRunRow[]): ToolDisplayItem[] {
  const out: ToolDisplayItem[] = [];
  let batch: ToolRunRow[] = [];

  const flushBatch = () => {
    if (batch.length === 0) return;
    if (batch.length === 1) {
      out.push({ kind: "tool", row: batch[0]! });
    } else {
      out.push({
        kind: "readonly-batch",
        rows: batch,
        label: readonlyBatchLabel(batch),
      });
    }
    batch = [];
  };

  for (const row of rows) {
    if (isBatchable(row)) {
      batch.push(row);
      continue;
    }
    flushBatch();
    out.push({ kind: "tool", row });
  }
  flushBatch();
  return out;
}

export function readonlyBatchLabel(rows: ToolRunRow[]): string {
  const names = [...new Set(rows.map((r) => r.tool))];
  const tools = names.length <= 3 ? names.join(" · ") : `${names.slice(0, 2).join(" · ")} 等`;
  return `${tools}（${rows.length}）`;
}
