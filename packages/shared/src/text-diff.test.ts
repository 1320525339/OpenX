import { describe, expect, it } from "vitest";
import {
  collapseDiffContext,
  collapseDiffDisplayContext,
  countDiffChanges,
  diffDisplayRows,
  diffLineRows,
  diffRowsFromUnifiedDiff,
  formatUnifiedDiff,
  buildToolFileDiff,
  cleanGitDiff,
  isUnifiedDiffMetaLine,
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
    expect(text).toContain("@@");
    expect(text).toContain("-old");
    expect(text).toContain("+new");
  });

  it("formats separate hunks with local line counts", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
    const after = [...before];
    after[1] = "changed2";
    after[16] = "changed17";
    const text = formatUnifiedDiff(before.join("\n"), after.join("\n"), { path: "x.ts" });
    const hunkHeaders = text.match(/^@@ .+ @@$/gm) ?? [];
    expect(hunkHeaders).toEqual(["@@ -1,5 +1,5 @@", "@@ -14,7 +14,7 @@"]);

    const rows = diffRowsFromUnifiedDiff(text);
    expect(rows.find((row) => row.type === "del" && row.text === "line17")?.oldLine).toBe(17);
    expect(rows.find((row) => row.type === "add" && row.text === "changed17")?.newLine).toBe(17);
  });

  it("diffRowsFromUnifiedDiff skips meta headers and assigns line numbers", () => {
    const diff = formatUnifiedDiff("line1\nold\nline3", "line1\nnew\nline3", {
      path: "f.ts",
    });
    const rows = diffRowsFromUnifiedDiff(diff);
    expect(rows.some((r) => r.type === "del" && r.text === "old")).toBe(true);
    expect(rows.some((r) => r.type === "add" && r.text === "new")).toBe(true);
    expect(rows.every((r) => !r.text.startsWith("---"))).toBe(true);
  });

  it("diffRowsFromUnifiedDiff falls back when hunk headers are missing", () => {
    const rows = diffRowsFromUnifiedDiff("--- a/f.ts\n+++ b/f.ts\n old\n-removed\n+added");
    expect(rows.map((row) => row.type)).toEqual(["ctx", "del", "add"]);
    expect(rows.find((row) => row.type === "del")?.oldLine).toBe(2);
    expect(rows.find((row) => row.type === "add")?.newLine).toBe(2);
  });

  it("diffDisplayRows tracks old and new line numbers", () => {
    const rows = diffDisplayRows("a\nb", "a\nc");
    const del = rows.find((r) => r.type === "del");
    const add = rows.find((r) => r.type === "add");
    expect(del?.oldLine).toBe(2);
    expect(add?.newLine).toBe(2);
  });

  it("collapseDiffDisplayContext inserts ellipsis", () => {
    const rows = diffDisplayRows("same\n".repeat(10) + "old", "same\n".repeat(10) + "new");
    const collapsed = collapseDiffDisplayContext(rows, 1);
    expect(collapsed.some((r) => r.type === "ellipsis")).toBe(true);
  });

  it("collapses long unchanged runs", () => {
    const before = ["keep1", "keep2", "keep3", "keep4", "old", "tail1", "tail2"].join("\n");
    const after = ["keep1", "keep2", "keep3", "keep4", "new", "tail1", "tail2"].join("\n");
    const rows = diffLineRows(before, after);
    const collapsed = collapseDiffContext(rows, 1);
    expect(collapsed.some((l) => l.type === "ellipsis")).toBe(true);
  });

  it("buildToolFileDiff returns stats and unified text", () => {
    const built = buildToolFileDiff("a\nold", "a\nnew", { path: "src/x.ts" });
    expect(built?.added).toBe(1);
    expect(built?.removed).toBe(1);
    expect(built?.diff).toContain("+new");
    expect(built?.path).toBe("src/x.ts");
  });

  it("buildToolFileDiff returns null when identical", () => {
    expect(buildToolFileDiff("same", "same")).toBeNull();
  });

  it("isUnifiedDiffMetaLine skips git file headers", () => {
    expect(isUnifiedDiffMetaLine("--- a/file.ts")).toBe(true);
    expect(isUnifiedDiffMetaLine("diff --git a/x b/x")).toBe(true);
    expect(isUnifiedDiffMetaLine("index 123..456")).toBe(true);
    expect(isUnifiedDiffMetaLine("Binary files a/x and b/x differ")).toBe(true);
    expect(isUnifiedDiffMetaLine("+added")).toBe(false);
  });

  it("collapseDiffDisplayContext keeps explicit ellipsis boundaries", () => {
    const rows = diffRowsFromUnifiedDiff(
      "@@ -1,8 +1,8 @@\n a\n b\n c\n d\n e\n f\n-old\n+new\n...\n@@ -20,3 +20,3 @@\n tail\n-old2\n+new2",
    );
    const collapsed = collapseDiffDisplayContext(rows, 1);
    expect(collapsed.filter((row) => row.type === "ellipsis").length).toBeGreaterThanOrEqual(1);
    expect(collapsed.some((row) => row.type === "add" && row.text === "new2")).toBe(true);
  });

  it("cleanGitDiff strips git headers", () => {
    const raw = [
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -1,2 +1,2 @@",
      "-old",
      "+new",
    ].join("\n");
    expect(cleanGitDiff(raw)).toBe("-old\n+new");
  });
});
