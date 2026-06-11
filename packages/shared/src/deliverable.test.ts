import { describe, expect, it } from "vitest";
import {
  deliverableSummaryLabel,
  parseDeliverablesFromSummary,
  resolveGoalDeliverables,
} from "./deliverable.js";

describe("deliverable", () => {
  it("parses fenced code blocks", () => {
    const items = parseDeliverablesFromSummary(
      "已完成。\n```ts\nexport const x = 1;\n```",
    );
    expect(items.some((i) => i.kind === "snippet" && i.code.includes("export"))).toBe(
      true,
    );
  });

  it("parses file paths from summary text", () => {
    const items = parseDeliverablesFromSummary(
      "已修改 apps/web/src/App.tsx 与 packages/shared/src/index.ts",
    );
    const files = items.filter((i) => i.kind === "file");
    expect(files.length).toBeGreaterThanOrEqual(2);
    expect(files.some((f) => f.label === "App.tsx")).toBe(true);
  });

  it("prefers structured deliverables on goal", () => {
    const items = resolveGoalDeliverables({
      deliverables: [{ kind: "file", path: "a.ts", label: "a.ts" }],
      resultSummary: "ignored path b.ts",
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.kind === "file" && items[0].path).toBe("a.ts");
  });

  it("builds compact summary label", () => {
    const label = deliverableSummaryLabel([
      { kind: "file", path: "a.ts", label: "a.ts" },
      { kind: "file", path: "b.ts", label: "b.ts" },
      { kind: "snippet", code: "x", label: "片段" },
    ]);
    expect(label).toBe("2 个文件 · 1 段代码");
  });
});
