import { describe, expect, it } from "vitest";
import { extractDeliverableFromTool, mergeDeliverable } from "./deliverables.js";

describe("executor deliverables", () => {
  it("includes previousContent when provided", () => {
    const item = extractDeliverableFromTool(
      "edit",
      { path: "src/foo.ts", content: "new" },
      { ok: true },
      false,
      { previousContent: "old" },
    );
    expect(item?.kind === "file" && item.previousContent).toBe("old");
    expect(item?.kind === "file" && item.action).toBe("modified");
  });

  it("extracts file deliverable from write tool args", () => {
    const item = extractDeliverableFromTool(
      "write",
      { path: "src/foo.ts", content: "export const x = 1;" },
      { ok: true },
      false,
    );
    expect(item?.kind).toBe("file");
    if (item?.kind === "file") {
      expect(item.path).toBe("src/foo.ts");
      expect(item.action).toBe("created");
      expect(item.preview).toContain("export const x");
    }
  });

  it("merges file deliverables by path", () => {
    const list = mergeDeliverable([], {
      kind: "file",
      path: "a.ts",
      label: "a.ts",
      action: "created",
    });
    mergeDeliverable(list, {
      kind: "file",
      path: "a.ts",
      label: "a.ts",
      action: "modified",
      preview: "updated",
    });
    expect(list).toHaveLength(1);
    expect(list[0]?.kind === "file" && list[0].action).toBe("modified");
    expect(list[0]?.kind === "file" && list[0].preview).toBe("updated");
  });
});
