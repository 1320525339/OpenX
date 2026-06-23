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

  it("handles deeply nested payload without stack overflow (depth > 5)", () => {
    // 构造 10 层嵌套 result 对象，验证不会无限递归
    let nested: Record<string, unknown> = { content: "deep-value" };
    for (let i = 0; i < 10; i++) {
      nested = { result: nested };
    }
    // 深度超过 5 层后不再递归，不会崩溃
    const item = extractDeliverableFromTool(
      "write",
      { path: "src/deep.ts", ...nested },
      { ok: true },
      false,
    );
    // 超过深度限制后 preview 为 undefined，但仍能正常返回交付物
    expect(item).not.toBeNull();
    expect(item?.kind).toBe("file");
  });

  it("handles circular-like self-referencing payload gracefully", () => {
    // 构造自引用对象（result 指向自身）
    const self: Record<string, unknown> = { result: null };
    self.result = self;
    const item = extractDeliverableFromTool(
      "edit",
      { path: "src/circular.ts", ...self },
      { ok: true },
      false,
    );
    // 不应崩溃，仍返回基本交付物
    expect(item).not.toBeNull();
    expect(item?.kind).toBe("file");
  });
});
