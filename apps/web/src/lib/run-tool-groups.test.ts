import { describe, expect, it } from "vitest";
import { groupToolDisplayItems, readonlyBatchLabel } from "./run-tool-groups";
import type { ToolRunRow } from "./run-tool-rows";

function row(partial: Partial<ToolRunRow> & Pick<ToolRunRow, "key" | "tool">): ToolRunRow {
  return {
    running: false,
    readOnly: false,
    isShell: false,
    subject: "",
    summary: "",
    ...partial,
  };
}

describe("groupToolDisplayItems", () => {
  it("merges consecutive completed read-only tools", () => {
    const items = groupToolDisplayItems([
      row({ key: "1", tool: "grep", readOnly: true, subject: "a" }),
      row({ key: "2", tool: "read_file", readOnly: true, subject: "b.ts" }),
      row({ key: "3", tool: "bash", isShell: true, subject: "test" }),
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]?.kind).toBe("readonly-batch");
    if (items[0]?.kind === "readonly-batch") {
      expect(items[0].rows).toHaveLength(2);
    }
    expect(items[1]?.kind).toBe("tool");
  });

  it("does not batch running read-only tools", () => {
    const items = groupToolDisplayItems([
      row({ key: "1", tool: "grep", readOnly: true, running: true }),
      row({ key: "2", tool: "grep", readOnly: true }),
    ]);
    expect(items.every((i) => i.kind === "tool")).toBe(true);
  });
});

describe("readonlyBatchLabel", () => {
  it("lists tool names with count", () => {
    expect(
      readonlyBatchLabel([
        row({ key: "1", tool: "grep" }),
        row({ key: "2", tool: "read_file" }),
      ]),
    ).toBe("grep · read_file（2）");
  });
});
