import { describe, expect, it } from "vitest";
import { buildToolRows } from "./run-tool-rows";

const ts = "2026-06-08T00:00:00.000Z";

describe("buildToolRows", () => {
  it("pairs tools by toolCallId when names collide", () => {
    const rows = buildToolRows([
      { type: "tool.start", tool: "read", toolCallId: "a", timestamp: ts },
      { type: "tool.start", tool: "read", toolCallId: "b", timestamp: ts },
      { type: "tool.end", tool: "read", toolCallId: "a", timestamp: ts },
      { type: "tool.end", tool: "read", toolCallId: "b", isError: true, timestamp: ts },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.running).toBe(false);
    expect(rows[1]?.running).toBe(false);
    expect(rows[1]?.isError).toBe(true);
  });

  it("merges tool.update output into open row", () => {
    const rows = buildToolRows([
      {
        type: "tool.start",
        tool: "bash",
        toolCallId: "x",
        argsPreview: '{"cmd":"ls"}',
        timestamp: ts,
      },
      {
        type: "tool.update",
        tool: "bash",
        toolCallId: "x",
        outputPreview: "file.txt",
        timestamp: ts,
      },
      { type: "tool.end", tool: "bash", toolCallId: "x", resultPreview: "ok", timestamp: ts },
    ]);
    expect(rows[0]?.outputPreview).toBe("file.txt");
    expect(rows[0]?.resultPreview).toBe("ok");
    expect(rows[0]?.isShell).toBe(true);
    expect(rows[0]?.subject).toBeTruthy();
  });

  it("enriches read-only grep with subject and match summary", () => {
    const rows = buildToolRows([
      {
        type: "tool.start",
        tool: "grep",
        toolCallId: "g1",
        argsPreview: '{"pattern":"TODO"}',
        timestamp: ts,
      },
      {
        type: "tool.end",
        tool: "grep",
        toolCallId: "g1",
        resultPreview: "a\nb",
        timestamp: ts,
      },
    ]);
    expect(rows[0]?.readOnly).toBe(true);
    expect(rows[0]?.subject).toBe("TODO");
    expect(rows[0]?.summary).toBe("2 匹配");
  });

  it("carries fileDiff from tool.end", () => {
    const rows = buildToolRows([
      {
        type: "tool.start",
        tool: "edit_file",
        toolCallId: "e1",
        argsPreview: '{"path":"a.ts"}',
        timestamp: ts,
      },
      {
        type: "tool.end",
        tool: "edit_file",
        toolCallId: "e1",
        fileDiff: { diff: "-old\n+new", added: 1, removed: 1, path: "a.ts" },
        timestamp: ts,
      },
    ]);
    expect(rows[0]?.fileDiff?.path).toBe("a.ts");
    expect(rows[0]?.summary).toBe("+1 -1");
  });
});
