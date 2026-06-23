/** Executor 工具卡片展示逻辑（借鉴 Reasonix subject/summary，纯函数便于单测） */

import type { ToolFileDiff } from "@openx/shared";

export const READ_ONLY_TOOLS = new Set([
  "read",
  "read_file",
  "grep",
  "glob",
  "ls",
  "list_dir",
  "web_fetch",
  "search",
  "find",
]);

const SHELL_TOOLS = new Set(["bash", "shell", "run_terminal_cmd", "terminal"]);

function parseArgs(argsPreview?: string): Record<string, unknown> {
  if (!argsPreview?.trim()) return {};
  const raw = argsPreview.trim();
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function str(obj: Record<string, unknown>, key: string): string {
  return typeof obj[key] === "string" ? (obj[key] as string) : "";
}

export function isReadOnlyTool(tool: string): boolean {
  return READ_ONLY_TOOLS.has(tool);
}

export function isShellTool(tool: string): boolean {
  return SHELL_TOOLS.has(tool) || tool.includes("bash") || tool.includes("shell");
}

/** 折叠行右侧一行摘要：命令、路径、搜索模式等 */
export function subjectOf(tool: string, argsPreview?: string): string {
  const a = parseArgs(argsPreview);
  switch (tool) {
    case "bash":
    case "shell":
    case "run_terminal_cmd":
    case "terminal":
      return str(a, "command") || str(a, "cmd") || str(a, "input");
    case "grep":
    case "glob":
    case "search":
      return str(a, "pattern") || str(a, "query") || str(a, "path");
    case "web_fetch":
      return str(a, "url");
    case "write_file":
    case "edit_file":
    case "multi_edit":
      return str(a, "path") || str(a, "file_path");
    default:
      return str(a, "path") || str(a, "file_path") || str(a, "file");
  }
}

function nonEmptyLineCount(text: string): number {
  return text.split("\n").filter((l) => l.trim()).length;
}

function lineCount(text: string): number {
  if (!text) return 0;
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (!trimmed) return 0;
  return trimmed.split("\n").length;
}

/** 完成后的结果摘要（+/- 行数、匹配数等） */
export function summarizeToolResult(
  tool: string,
  argsPreview?: string,
  outputPreview?: string,
  resultPreview?: string,
  isError?: boolean,
): string {
  if (isError) return "失败";
  const output = outputPreview || resultPreview || "";
  const a = parseArgs(argsPreview);

  if (tool === "write_file" && typeof a.content === "string") {
    const n = lineCount(a.content);
    return n > 0 ? `${n} 行` : "";
  }
  if ((tool === "edit_file" || tool === "write_file") && output.includes("+")) {
    const plus = output.match(/\+(\d+)/)?.[1];
    const minus = output.match(/-(\d+)/)?.[1];
    if (plus || minus) return `+${plus ?? 0} -${minus ?? 0}`;
  }
  if (!output) return "";

  switch (tool) {
    case "grep":
    case "search":
      return `${nonEmptyLineCount(output)} 匹配`;
    case "glob":
    case "find":
      return `${nonEmptyLineCount(output)} 文件`;
    case "ls":
    case "list_dir":
      return `${nonEmptyLineCount(output)} 项`;
    case "read_file":
    case "read":
      return `${lineCount(output)} 行`;
    default:
      if (output.length <= 48) return output;
      return `${output.slice(0, 45)}…`;
  }
}

export type EnrichedToolRow = {
  subject: string;
  readOnly: boolean;
  isShell: boolean;
  summary: string;
};

export function summarizeFileDiff(fileDiff?: ToolFileDiff): string {
  if (!fileDiff || (fileDiff.added === 0 && fileDiff.removed === 0)) return "";
  return `+${fileDiff.added} -${fileDiff.removed}`;
}

export function enrichToolRow(row: {
  tool: string;
  argsPreview?: string;
  outputPreview?: string;
  resultPreview?: string;
  fileDiff?: ToolFileDiff;
  running: boolean;
  isError?: boolean;
}): EnrichedToolRow {
  const subject = subjectOf(row.tool, row.argsPreview);
  const readOnly = isReadOnlyTool(row.tool);
  const isShell = isShellTool(row.tool);
  const diffSummary = summarizeFileDiff(row.fileDiff);
  const summary = row.running
    ? ""
    : diffSummary ||
      summarizeToolResult(
        row.tool,
        row.argsPreview,
        row.outputPreview,
        row.resultPreview,
        row.isError,
      );
  return { subject, readOnly, isShell, summary };
}

/** Shell 输出默认预览行数 */
export const SHELL_PREVIEW_LINES = 6;

export function splitShellPreview(
  text: string,
  maxLines = SHELL_PREVIEW_LINES,
): { preview: string; totalLines: number; hasMore: boolean } {
  const lines = text.split("\n");
  const totalLines = lines.length;
  if (totalLines <= maxLines) {
    return { preview: text, totalLines, hasMore: false };
  }
  return {
    preview: lines.slice(0, maxLines).join("\n"),
    totalLines,
    hasMore: true,
  };
}
