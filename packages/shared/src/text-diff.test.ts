import { describe, expect, it } from "vitest";
import {
  collapseDiffContext,
  countDiffChanges,
  diffLineRows,
  formatUnifiedDiff,
} from "./text-diff.js";

describe("text-diff", () => {
  it("diffs added and removed lines", () => {
    const rows = diffLineRows("a\nb\nc", "a\nx\nc");
    expect(rows).toEqual([
      { type: "same", text: "a" },
      { type: "remove", text: "b" },
      { type: "add", text: "x" },
      { type: "same", text: "c" },
    ]);
    expect(countDiffChanges(rows)).toEqual({ added: 1, removed: 1 });
  });

  it("formats unified diff text", () => {
    const text = formatUnifiedDiff("a\nold\nb", "a\nnew\nb", { path: "x.ts" });
    expect(text).toContain("--- a/x.ts");
    expect(text).toContain("-old");
    expect(text).toContain("+new");
  });

  it("collapses long unchanged runs", () => {
    const before = ["keep1", "keep2", "keep3", "keep4", "old", "tail1", "tail2"].join("\n");
    const after = ["keep1", "keep2", "keep3", "keep4", "new", "tail1", "tail2"].join("\n");
    const rows = diffLineRows(before, after);
    const collapsed = collapseDiffContext(rows, 1);
    expect(collapsed.some((l) => l.type === "ellipsis")).toBe(true);
  });
});
