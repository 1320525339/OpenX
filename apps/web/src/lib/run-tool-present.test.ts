import { describe, expect, it } from "vitest";
import {
  enrichToolRow,
  isReadOnlyTool,
  isShellTool,
  splitShellPreview,
  subjectOf,
  summarizeToolResult,
} from "./run-tool-present";

describe("subjectOf", () => {
  it("extracts bash command from JSON args", () => {
    expect(subjectOf("bash", '{"command":"pnpm test"}')).toBe("pnpm test");
  });

  it("extracts file path for read tools", () => {
    expect(subjectOf("read_file", '{"path":"src/index.ts"}')).toBe("src/index.ts");
  });

  it("extracts grep pattern", () => {
    expect(subjectOf("grep", '{"pattern":"TODO","path":"."}')).toBe("TODO");
  });
});

describe("isReadOnlyTool / isShellTool", () => {
  it("classifies read-only tools", () => {
    expect(isReadOnlyTool("grep")).toBe(true);
    expect(isReadOnlyTool("write_file")).toBe(false);
  });

  it("classifies shell tools", () => {
    expect(isShellTool("bash")).toBe(true);
    expect(isShellTool("read_file")).toBe(false);
  });
});

describe("summarizeToolResult", () => {
  it("counts grep matches", () => {
    expect(
      summarizeToolResult("grep", undefined, "a\nb\nc\n", undefined, false),
    ).toBe("3 匹配");
  });

  it("returns 失败 on error", () => {
    expect(summarizeToolResult("bash", undefined, undefined, undefined, true)).toBe(
      "失败",
    );
  });

  it("returns empty while no output for running tools via enrichToolRow", () => {
    expect(
      enrichToolRow({
        tool: "grep",
        running: true,
      }).summary,
    ).toBe("");
  });
});

describe("enrichToolRow", () => {
  it("marks read-only grep with subject and summary", () => {
    const e = enrichToolRow({
      tool: "grep",
      argsPreview: '{"pattern":"foo"}',
      outputPreview: "match1\nmatch2",
      running: false,
    });
    expect(e.readOnly).toBe(true);
    expect(e.subject).toBe("foo");
    expect(e.summary).toBe("2 匹配");
  });
});

describe("splitShellPreview", () => {
  it("truncates long shell output", () => {
    const text = "line1\nline2\nline3\nline4\nline5\nline6\nline7";
    const { preview, hasMore, totalLines } = splitShellPreview(text, 3);
    expect(hasMore).toBe(true);
    expect(totalLines).toBe(7);
    expect(preview).toBe("line1\nline2\nline3");
  });
});
