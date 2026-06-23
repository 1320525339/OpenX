import { describe, expect, it } from "vitest";
import { formatThinkingDisplay, thinkingSummaryLabel } from "./thinking-display";

describe("formatThinkingDisplay", () => {
  it("keeps full text when under limits", () => {
    expect(formatThinkingDisplay("hello")).toBe("hello");
  });

  it("truncates by line count in compact mode", () => {
    const lines = Array.from({ length: 150 }, (_, i) => `line ${i}`).join("\n");
    const out = formatThinkingDisplay(lines, { compact: true, maxLines: 10, maxChars: 9999 });
    expect(out.split("\n")).toHaveLength(10);
    expect(out.startsWith("line 140")).toBe(true);
  });

  it("truncates by char count with ellipsis prefix", () => {
    const text = "x".repeat(2000);
    const out = formatThinkingDisplay(text, { maxChars: 100 });
    expect(out.length).toBe(101);
    expect(out.startsWith("…")).toBe(true);
  });
});

describe("thinkingSummaryLabel", () => {
  it("shows active label while streaming", () => {
    expect(thinkingSummaryLabel("long text", true)).toBe("思考中…");
  });

  it("shows segment count for multiline", () => {
    expect(thinkingSummaryLabel("a\nb", false)).toBe("思考（2 段 · 3 字）");
  });
});
