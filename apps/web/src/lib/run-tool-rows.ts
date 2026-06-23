import type { RunStreamEvent, ToolFileDiff } from "@openx/shared";
import { enrichToolRow } from "./run-tool-present";

export type ToolRunRow = {
  key: string;
  tool: string;
  toolCallId?: string;
  running: boolean;
  isError?: boolean;
  argsPreview?: string;
  outputPreview?: string;
  resultPreview?: string;
  fileDiff?: ToolFileDiff;
  /** 一行语义摘要（路径、命令、模式） */
  subject: string;
  readOnly: boolean;
  isShell: boolean;
  /** 完成后结果摘要 */
  summary: string;
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

function applyEnrichment(row: Omit<ToolRunRow, "subject" | "readOnly" | "isShell" | "summary">): ToolRunRow {
  const meta = enrichToolRow(row);
  return { ...row, ...meta };
}

function refreshEnrichment(row: ToolRunRow): ToolRunRow {
  return applyEnrichment(row);
}

/** 从 run 事件序列构建工具行（优先 toolCallId 配对） */
export function buildToolRows(events: RunStreamEvent[]): ToolRunRow[] {
  const rows: ToolRunRow[] = [];
  let orphanIndex = 0;

  for (const e of events) {
    if (e.type === "tool.start") {
      const key = rowKey(e.tool, e.toolCallId, orphanIndex++);
      rows.push(
        applyEnrichment({
          key,
          tool: e.tool,
          toolCallId: e.toolCallId,
          running: true,
          argsPreview: e.argsPreview,
        }),
      );
      continue;
    }
    if (e.type === "tool.update") {
      const row = findOpenRow(rows, e.tool, e.toolCallId);
      if (row && e.outputPreview) {
        row.outputPreview = e.outputPreview;
        Object.assign(row, enrichToolRow(row));
      }
      continue;
    }
    if (e.type === "tool.end") {
      const row = findOpenRow(rows, e.tool, e.toolCallId);
      if (row) {
        row.running = false;
        row.isError = e.isError;
        if (e.resultPreview) row.resultPreview = e.resultPreview;
        if (e.fileDiff) row.fileDiff = e.fileDiff;
        Object.assign(row, enrichToolRow(row));
      } else {
        rows.push(
          applyEnrichment({
            key: rowKey(e.tool, e.toolCallId, orphanIndex++),
            tool: e.tool,
            toolCallId: e.toolCallId,
            running: false,
            isError: e.isError,
            resultPreview: e.resultPreview,
            fileDiff: e.fileDiff,
          }),
        );
      }
    }
  }

  return rows.map(refreshEnrichment);
}
