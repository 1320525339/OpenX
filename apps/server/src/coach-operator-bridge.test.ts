import { describe, expect, it } from "vitest";
import { isAmbiguousTaskMessage } from "@openx/shared";
import { shouldUseOperatorTools } from "./coach-operator-bridge.js";

describe("shouldUseOperatorTools", () => {
  it("does not intercept ambiguous task messages on read tier", () => {
    const msg = "帮我优化一下";
    expect(isAmbiguousTaskMessage(msg)).toBe(true);
    expect(shouldUseOperatorTools("read", msg)).toBe(false);
  });

  it("does not intercept explicit task messages on read tier", () => {
    expect(shouldUseOperatorTools("read", "帮我实现用户登录 API")).toBe(false);
  });

  it("still uses operator for read tier on non-ambiguous messages", () => {
    expect(shouldUseOperatorTools("read", "你好")).toBe(true);
  });

  it("respects forceRefine bypass", () => {
    expect(
      shouldUseOperatorTools("read", "帮我优化一下", { forceRefine: true }),
    ).toBe(false);
  });
});
