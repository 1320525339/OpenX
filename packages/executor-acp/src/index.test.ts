import { describe, expect, it } from "vitest";
import { acpExecutor } from "./index.js";

describe("acpExecutor", () => {
  it("registers as acp adapter", () => {
    expect(acpExecutor.id).toBe("acp");
    expect(acpExecutor.displayName).toContain("施工队");
  });
});
