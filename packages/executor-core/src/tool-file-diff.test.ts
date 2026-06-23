import { describe, expect, it } from "vitest";
import { toolFileDiffFromDeliverable } from "./tool-file-diff.js";

describe("toolFileDiffFromDeliverable", () => {
  it("builds diff when previous and preview exist", () => {
    const diff = toolFileDiffFromDeliverable({
      kind: "file",
      path: "src/a.ts",
      label: "a.ts",
      action: "modified",
      previousContent: "old\nline",
      preview: "new\nline",
      language: "typescript",
    });
    expect(diff?.added).toBe(1);
    expect(diff?.removed).toBe(1);
    expect(diff?.path).toBe("src/a.ts");
  });

  it("returns undefined for create-only files", () => {
    expect(
      toolFileDiffFromDeliverable({
        kind: "file",
        path: "b.ts",
        label: "b.ts",
        action: "created",
        preview: "hello",
        language: "typescript",
      }),
    ).toBeUndefined();
  });
});
