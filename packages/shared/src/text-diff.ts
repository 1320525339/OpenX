export type DiffLine = {
  type: "same" | "add" | "remove";
  text: string;
};

/** 行级 LCS diff（无第三方依赖） */
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

/** 折叠长段 unchanged 行，保留首尾 context 行 */
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

/** 统一 diff 文本（供审查员 LLM 阅读） */
export function formatUnifiedDiff(
  before: string,
  after: string,
  opts?: { path?: string; maxLines?: number },
): string {
  const rows = collapseDiffContext(diffLineRows(before, after), 3);
  const header: string[] = [];
  if (opts?.path) {
    header.push(`--- a/${opts.path}`, `+++ b/${opts.path}`);
  }
  const body: string[] = [];
  const maxLines = opts?.maxLines ?? 160;
  let lineCount = 0;
  for (const row of rows) {
    if (lineCount >= maxLines) {
      body.push("…（diff 已截断）");
      break;
    }
    if ("type" in row && row.type === "ellipsis") {
      body.push("…");
      lineCount += 1;
      continue;
    }
    const prefix = row.type === "add" ? "+" : row.type === "remove" ? "-" : " ";
    body.push(`${prefix}${row.text}`);
    lineCount += 1;
  }
  return [...header, ...body].join("\n");
}
