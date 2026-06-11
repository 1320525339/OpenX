import type { RunStreamEvent } from "@openx/shared";

export type ToolRunRow = {
  key: string;
  tool: string;
  toolCallId?: string;
  running: boolean;
  isError?: boolean;
  argsPreview?: string;
  outputPreview?: string;
  resultPreview?: string;
};

function rowKey(tool: string, toolCallId?: string, index?: number): string {
  return toolCallId ?? `${tool}-${index ?? 0}`;
}

function findOpenRow(
  rows: ToolRunRow[],
  tool: string,
  toolCallId?: string,
): ToolRunRow | undefined {
  if (toolCallId) {
    return rows.find((r) => r.toolCallId === toolCallId && r.running);
  }
  return [...rows].reverse().find((r) => r.tool === tool && r.running);
}

/** 从 run 事件序列构建工具行（优先 toolCallId 配对） */
export function buildToolRows(events: RunStreamEvent[]): ToolRunRow[] {
  const rows: ToolRunRow[] = [];
  let orphanIndex = 0;

  for (const e of events) {
    if (e.type === "tool.start") {
      const key = rowKey(e.tool, e.toolCallId, orphanIndex++);
      rows.push({
        key,
        tool: e.tool,
        toolCallId: e.toolCallId,
        running: true,
        argsPreview: e.argsPreview,
      });
      continue;
    }
    if (e.type === "tool.update") {
      const row = findOpenRow(rows, e.tool, e.toolCallId);
      if (row && e.outputPreview) {
        row.outputPreview = e.outputPreview;
      }
      continue;
    }
    if (e.type === "tool.end") {
      const row = findOpenRow(rows, e.tool, e.toolCallId);
      if (row) {
        row.running = false;
        row.isError = e.isError;
        if (e.resultPreview) row.resultPreview = e.resultPreview;
      } else {
        rows.push({
          key: rowKey(e.tool, e.toolCallId, orphanIndex++),
          tool: e.tool,
          toolCallId: e.toolCallId,
          running: false,
          isError: e.isError,
          resultPreview: e.resultPreview,
        });
      }
    }
  }

  return rows;
}
