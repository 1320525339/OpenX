import { describe, expect, it } from "vitest";
import { reasonixInlineDiffClipboard } from "./inline-diff";

describe("reasonix inline-diff seam", () => {
  it("copies body lines like Reasonix InlineDiff", () => {
    const text = reasonixInlineDiffClipboard([
      { type: "del", text: "old" },
      { type: "add", text: "new" },
    ]);
    expect(text).toBe("- old\n+ new");
  });
});
