export type DiffLine = {
  type: "same" | "add" | "remove";
  text: string;
};

/** UI 渲染用 diff 行，包含双列行号。 */
export type DiffDisplayRow = {
  type: "ctx" | "add" | "del" | "ellipsis";
  text: string;
  oldLine?: number;
  newLine?: number;
};

const HUNK_HEADER_RE = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/;

/** unified diff 文件/meta 行。 */
export function isUnifiedDiffMetaLine(line: string): boolean {
  if (line.startsWith("--- ") || line.startsWith("+++ ")) return true;
  if (line.startsWith("diff --git")) return true;
  if (line.startsWith("index ")) return true;
  if (line.startsWith("new file mode")) return true;
  if (line.startsWith("deleted file mode")) return true;
  if (line.startsWith("old mode ") || line.startsWith("new mode ")) return true;
  if (line.startsWith("rename from") || line.startsWith("rename to")) return true;
  if (line.startsWith("similarity index")) return true;
  if (line.startsWith("Binary files") || line.startsWith("GIT binary patch")) return true;
  if (line.startsWith("\\ No newline")) return true;
  return false;
}

/** 行级 LCS diff，无第三方依赖。 */
export function diffLineRows(before: string, after: string): DiffLine[] {
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  const m = oldLines.length;
  const n = newLines.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );

  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i][j] =
        oldLines[i] === newLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      result.push({ type: "same", text: oldLines[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: "remove", text: oldLines[i] });
      i += 1;
    } else {
      result.push({ type: "add", text: newLines[j] });
      j += 1;
    }
  }
  while (i < m) {
    result.push({ type: "remove", text: oldLines[i] });
    i += 1;
  }
  while (j < n) {
    result.push({ type: "add", text: newLines[j] });
    j += 1;
  }
  return result;
}

/** before/after LCS diff，带双列行号。 */
export function diffDisplayRows(before: string, after: string): DiffDisplayRow[] {
  const x = before.split("\n");
  const y = after.split("\n");
  const n = x.length;
  const m = y.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: DiffDisplayRow[] = [];
  let i = 0;
  let j = 0;
  let oldLine = 1;
  let newLine = 1;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      rows.push({ type: "ctx", text: x[i], oldLine, newLine });
      i += 1;
      j += 1;
      oldLine += 1;
      newLine += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: "del", text: x[i], oldLine });
      i += 1;
      oldLine += 1;
    } else {
      rows.push({ type: "add", text: y[j], newLine });
      j += 1;
      newLine += 1;
    }
  }
  while (i < n) {
    rows.push({ type: "del", text: x[i], oldLine });
    i += 1;
    oldLine += 1;
  }
  while (j < m) {
    rows.push({ type: "add", text: y[j], newLine });
    j += 1;
    newLine += 1;
  }
  return rows;
}

function isEllipsisLine(line: string): boolean {
  return line === "..." || line.startsWith("...") || line === "…" || line.startsWith("…");
}

function parseSimpleUnifiedDiffLines(diff: string): DiffDisplayRow[] {
  const rows: DiffDisplayRow[] = [];
  let oldLine = 1;
  let newLine = 1;
  const lines = diff.endsWith("\n") ? diff.slice(0, -1).split("\n") : diff.split("\n");
  for (const line of lines) {
    if (HUNK_HEADER_RE.test(line)) continue;
    if (isUnifiedDiffMetaLine(line)) continue;
    if (isEllipsisLine(line)) {
      rows.push({ type: "ellipsis", text: "…" });
      continue;
    }
    if (line.startsWith("+")) {
      rows.push({ type: "add", text: line.slice(1), newLine });
      newLine += 1;
      continue;
    }
    if (line.startsWith("-")) {
      rows.push({ type: "del", text: line.slice(1), oldLine });
      oldLine += 1;
      continue;
    }
    const text = line.startsWith(" ") ? line.slice(1) : line;
    rows.push({ type: "ctx", text, oldLine, newLine });
    oldLine += 1;
    newLine += 1;
  }
  return rows;
}

/** 解析 unified diff 为 UI 行，跳过 ---/+++ 与 @@ meta。 */
export function diffRowsFromUnifiedDiff(diff: string): DiffDisplayRow[] {
  const rows: DiffDisplayRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  const lines = diff.endsWith("\n") ? diff.slice(0, -1).split("\n") : diff.split("\n");

  for (const line of lines) {
    const header = HUNK_HEADER_RE.exec(line);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk) {
      if (isUnifiedDiffMetaLine(line)) continue;
      continue;
    }
    if (isUnifiedDiffMetaLine(line)) continue;
    if (isEllipsisLine(line)) {
      rows.push({ type: "ellipsis", text: "…" });
      continue;
    }

    const marker = line[0];
    const text = marker === " " || marker === "+" || marker === "-" ? line.slice(1) : line;
    if (marker === "+") {
      rows.push({ type: "add", text, newLine });
      newLine += 1;
      continue;
    }
    if (marker === "-") {
      rows.push({ type: "del", text, oldLine });
      oldLine += 1;
      continue;
    }
    rows.push({ type: "ctx", text, oldLine, newLine });
    oldLine += 1;
    newLine += 1;
  }

  if (rows.length > 0) return rows;
  return parseSimpleUnifiedDiffLines(diff);
}

/**
 * 来源：vendors/reasonix/desktop/frontend/src/lib/diff.ts · cleanGitDiff
 * 去掉 git 文件头，只保留 hunk 正文行。
 */
export function cleanGitDiff(diff: string): string {
  const lines = diff.split("\n");
  const cleaned: string[] = [];
  let inHunk = false;

  for (const line of lines) {
    if (line.startsWith("@@ ")) {
      inHunk = true;
      continue;
    }
    if (inHunk) cleaned.push(line);
  }

  if (cleaned.length === 0) {
    const match = diff.match(/^@@\s/m);
    if (match && match.index !== undefined) {
      return diff.slice(match.index).replace(/^@@.*$\n?/gm, "");
    }
    return diff;
  }

  return cleaned.join("\n");
}

/** 折叠长段 unchanged 行。 */
export function collapseDiffDisplayContext(
  lines: DiffDisplayRow[],
  contextLines = 3,
): DiffDisplayRow[] {
  if (lines.length === 0) return [];
  const out: DiffDisplayRow[] = [];
  let sameRun: DiffDisplayRow[] = [];

  const flushSame = () => {
    if (sameRun.length === 0) return;
    if (sameRun.length <= contextLines * 2) {
      out.push(...sameRun);
    } else {
      out.push(...sameRun.slice(0, contextLines));
      out.push({ type: "ellipsis", text: "…" });
      out.push(...sameRun.slice(-contextLines));
    }
    sameRun = [];
  };

  for (const line of lines) {
    if (line.type === "ellipsis") {
      flushSame();
      out.push(line);
      continue;
    }
    if (line.type === "ctx") {
      sameRun.push(line);
    } else {
      flushSame();
      out.push(line);
    }
  }
  flushSame();
  return out;
}

/** 折叠长段 unchanged 行，保留首尾 context 行。 */
export function collapseDiffContext(
  lines: DiffLine[],
  contextLines = 3,
): Array<DiffLine | { type: "ellipsis" }> {
  if (lines.length === 0) return [];
  const out: Array<DiffLine | { type: "ellipsis" }> = [];
  let sameRun: DiffLine[] = [];

  const flushSame = () => {
    if (sameRun.length === 0) return;
    if (sameRun.length <= contextLines * 2) {
      out.push(...sameRun);
    } else {
      out.push(...sameRun.slice(0, contextLines));
      out.push({ type: "ellipsis" });
      out.push(...sameRun.slice(-contextLines));
    }
    sameRun = [];
  };

  for (const line of lines) {
    if (line.type === "same") {
      sameRun.push(line);
    } else {
      flushSame();
      out.push(line);
    }
  }
  flushSame();
  return out;
}

export function countDiffChanges(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.type === "add") added += 1;
    if (line.type === "remove") removed += 1;
  }
  return { added, removed };
}

export function buildToolFileDiff(
  before: string,
  after: string,
  opts?: { path?: string; maxLines?: number },
): { diff: string; added: number; removed: number; path?: string } | null {
  const rows = diffLineRows(before, after);
  const { added, removed } = countDiffChanges(rows);
  if (added === 0 && removed === 0 && before === after) return null;
  return {
    diff: formatUnifiedDiff(before, after, opts),
    added,
    removed,
    path: opts?.path,
  };
}

type IndexedDiffLine = {
  row: DiffLine;
  oldLine: number;
  newLine: number;
};

/** 统一 diff 文本，供审查员和 UI 读取。 */
export function formatUnifiedDiff(
  before: string,
  after: string,
  opts?: { path?: string; maxLines?: number },
): string {
  const contextLines = 3;
  const rawRows = diffLineRows(before, after);
  const indexedRows: IndexedDiffLine[] = [];
  const changeIndexes: number[] = [];
  let oldLine = 1;
  let newLine = 1;

  rawRows.forEach((row, index) => {
    indexedRows.push({ row, oldLine, newLine });
    if (row.type !== "same") changeIndexes.push(index);
    if (row.type === "same") {
      oldLine += 1;
      newLine += 1;
    } else if (row.type === "remove") {
      oldLine += 1;
    } else {
      newLine += 1;
    }
  });

  const header: string[] = [];
  if (opts?.path) {
    header.push(`--- a/${opts.path}`, `+++ b/${opts.path}`);
  }
  if (changeIndexes.length === 0) return header.join("\n");

  const hunks: Array<{ start: number; end: number }> = [];
  let start = Math.max(0, changeIndexes[0] - contextLines);
  let end = Math.min(rawRows.length, changeIndexes[0] + contextLines + 1);
  for (const changeIndex of changeIndexes.slice(1)) {
    const nextStart = Math.max(0, changeIndex - contextLines);
    const nextEnd = Math.min(rawRows.length, changeIndex + contextLines + 1);
    if (nextStart <= end) {
      end = Math.max(end, nextEnd);
    } else {
      hunks.push({ start, end });
      start = nextStart;
      end = nextEnd;
    }
  }
  hunks.push({ start, end });

  const body: string[] = [];
  const maxLines = opts?.maxLines ?? 160;
  let lineCount = 0;
  let truncated = false;

  for (const hunk of hunks) {
    const hunkRows = indexedRows.slice(hunk.start, hunk.end);
    const first = hunkRows[0];
    if (!first) continue;
    const oldCount = hunkRows.filter((entry) => entry.row.type !== "add").length;
    const newCount = hunkRows.filter((entry) => entry.row.type !== "remove").length;

    if (lineCount >= maxLines) {
      truncated = true;
      break;
    }
    body.push(`@@ -${first.oldLine},${oldCount} +${first.newLine},${newCount} @@`);
    lineCount += 1;

    for (const { row } of hunkRows) {
      if (lineCount >= maxLines) {
        truncated = true;
        break;
      }
      const prefix = row.type === "add" ? "+" : row.type === "remove" ? "-" : " ";
      body.push(`${prefix}${row.text}`);
      lineCount += 1;
    }
    if (truncated) break;
  }

  if (truncated) body.push("...(diff truncated)");
  return [...header, ...body].join("\n");
}
