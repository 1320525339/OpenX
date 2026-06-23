import type { DiffDisplayRow } from "@openx/shared";

/**
 * 来源：vendors/reasonix/desktop/frontend/src/components/InlineDiff.tsx
 * copy() 使用的 plain-text unified 行格式（无行号、无文件头）。
 */
export function reasonixInlineDiffClipboard(rows: DiffDisplayRow[]): string {
  return rows
    .filter((row) => row.type !== "ellipsis")
    .map((row) => {
      if (row.type === "add") return `+ ${row.text}`;
      if (row.type === "del") return `- ${row.text}`;
      return `  ${row.text}`;
    })
    .join("\n");
}
