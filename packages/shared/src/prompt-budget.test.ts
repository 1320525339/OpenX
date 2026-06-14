import { describe, expect, it } from "vitest";
import { clipPromptList, clipPromptText, estimatePromptTokens } from "./prompt-budget.js";

describe("prompt-budget", () => {
  it("clips long text within budget", () => {
    const long = "行\n".repeat(5000);
    const clipped = clipPromptText(long, 100);
    expect(estimatePromptTokens(clipped)).toBeLessThanOrEqual(110);
    expect(clipped).toContain("截断");
  });

  it("keeps first and recent list items under budget", () => {
    const items = Array.from({ length: 10 }, (_, i) => `round-${i}-${"x".repeat(200)}`);
    const out = clipPromptList(items, 400, { keepFirst: true });
    expect(out).toContain("round-0");
    expect(out).toContain("round-9");
    expect(estimatePromptTokens(out)).toBeLessThanOrEqual(450);
  });
});
