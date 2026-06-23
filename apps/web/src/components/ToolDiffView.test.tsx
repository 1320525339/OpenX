import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { formatUnifiedDiff } from "@openx/shared";
import { ToolDiffView, ToolInlineDiffView } from "./ToolDiffView";
import { MarkdownDiffBlock } from "./MarkdownDiffBlock";
import { reasonixInlineDiffClipboard } from "../vendor-seams/reasonix/inline-diff";
import { highlightToHtml } from "../lib/code-highlight";

describe("ToolDiffView", () => {
  it("renders path and separate add/remove badges", async () => {
    render(
      <ToolDiffView
        fileDiff={{
          path: "src/a.ts",
          added: 2,
          removed: 1,
          diff: "--- a/src/a.ts\n+++ b/src/a.ts\n-old\n+new\n+line",
        }}
        defaultOpen
      />,
    );
    expect(screen.getByText("src/a.ts")).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByText("−1")).toBeInTheDocument();
    await waitFor(() => {
      expect(document.querySelector(".tool-diff-line")).toBeTruthy();
    });
  });

  it("syntax-highlights code lines and hides meta headers", async () => {
    const diff = formatUnifiedDiff(
      'const old = "a";',
      'const value = "b";',
      { path: "src/a.ts" },
    );
    const { container } = render(
      <ToolDiffView
        fileDiff={{ path: "src/a.ts", added: 1, removed: 1, diff }}
        defaultOpen
      />,
    );
    await waitFor(() => {
      expect(container.querySelector(".tool-diff-code.hljs .hljs-keyword")).toBeTruthy();
    });
    expect(container.querySelector(".tool-diff-code.hljs .hljs-string")).toBeTruthy();
    expect(screen.queryByText(/--- a\//)).not.toBeInTheDocument();
    expect(container.querySelector(".tool-diff-ln-old")).toBeTruthy();
    expect(container.querySelector(".tool-diff-sign")).toBeTruthy();
  });

  it("copies body-only diff like Reasonix InlineDiff", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    const diff = formatUnifiedDiff("a\nold", "a\nnew", { path: "a.ts" });
    render(
      <ToolDiffView
        fileDiff={{ path: "a.ts", added: 1, removed: 1, diff }}
        defaultOpen
      />,
    );

    await waitFor(() => {
      expect(document.querySelector(".tool-diff-line")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "复制 diff" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
    const copied = String(writeText.mock.calls[0]?.[0] ?? "");
    expect(copied).not.toContain("--- a/");
    expect(copied).toContain("- old");
    expect(copied).toContain("+ new");
    vi.unstubAllGlobals();
  });

  it("copies full unified diff when Alt is held", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    const diff = formatUnifiedDiff("a\nold", "a\nnew", { path: "a.ts" });
    render(
      <ToolDiffView
        fileDiff={{ path: "a.ts", added: 1, removed: 1, diff }}
        defaultOpen
      />,
    );

    await waitFor(() => {
      expect(document.querySelector(".tool-diff-line")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "复制 diff" }), { altKey: true });
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(diff);
    });
    vi.unstubAllGlobals();
  });

  it("collapses long unchanged runs in the tool view", async () => {
    const before = `${"same\n".repeat(12)}old\n${"tail\n".repeat(4)}`.trimEnd();
    const after = `${"same\n".repeat(12)}new\n${"tail\n".repeat(4)}`.trimEnd();
    render(<ToolInlineDiffView before={before} after={after} path="src/a.ts" />);
    await waitFor(() => {
      expect(screen.getAllByText("未变更行已折叠").length).toBeGreaterThan(0);
    });
  });
});

describe("ToolInlineDiffView", () => {
  it("renders add/remove lines with highlighting", async () => {
    highlightToHtml('const x = "a";', "typescript");
    const { container } = render(
      <ToolInlineDiffView before="a\nold" after="a\nnew" path="x.ts" />,
    );
    await waitFor(() => {
      expect(container.querySelector(".tool-diff-line")).toBeTruthy();
    });
    expect(screen.getByText("x.ts")).toBeInTheDocument();
  });
});

describe("MarkdownDiffBlock", () => {
  it("renders Hermes chat-diff fence lines", () => {
    render(<MarkdownDiffBlock code={"-old\n+new\n@@ -1 +1 @@"} />);
    expect(document.querySelector(".chat-diff-add")).toBeTruthy();
    expect(document.querySelector(".chat-diff-remove")).toBeTruthy();
    expect(document.querySelector(".chat-diff-hunk")).toBeTruthy();
  });

  it("hides unified file meta like Hermes DiffView", () => {
    render(<MarkdownDiffBlock code={"--- a/x.ts\n+++ b/x.ts\n-old\n+new"} />);
    expect(screen.queryByText(/--- a\/x/)).not.toBeInTheDocument();
    expect(document.querySelector(".chat-diff-remove")).toBeTruthy();
  });
});

describe("reasonixInlineDiffClipboard", () => {
  it("matches Reasonix clipboard shape", () => {
    expect(reasonixInlineDiffClipboard([{ type: "add", text: "x" }])).toBe("+ x");
  });
});
