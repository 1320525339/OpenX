import { describe, expect, it } from "vitest";
import { shouldGatherProjectContext, gatherContextPack } from "./context-pack.js";
import { listKnownExecutorIds } from "./skills-resolve.js";
import { DEFAULT_SETTINGS } from "@openx/shared";

describe("context-pack", () => {
  it("detects implementation-related messages", () => {
    expect(shouldGatherProjectContext("帮我修复登录 bug")).toBe(true);
    expect(shouldGatherProjectContext("你好")).toBe(false);
  });

  it("gathers file tree from workspace root", () => {
    const pack = gatherContextPack(process.cwd());
    expect(pack).not.toBeNull();
    expect(pack!.fileTree.length).toBeGreaterThan(0);
    expect(pack!.root).toBe(process.cwd());
  });
});

describe("skills-resolve listKnownExecutorIds", () => {
  it("does not double-prefix acp runtime ids", () => {
    const ids = listKnownExecutorIds(DEFAULT_SETTINGS);
    expect(ids).toContain("acp:gemini");
    expect(ids.some((id) => id.startsWith("acp:acp:"))).toBe(false);
  });
});
