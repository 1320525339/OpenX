import { describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  inferVerifyCommands,
  isAllowedVerifyCommand,
  runReviewVerification,
} from "./review-verify.js";

describe("review-verify", () => {
  it("infers commands from acceptance backticks", () => {
    const cmds = inferVerifyCommands(
      ["验收：`pnpm test` 全部通过"],
      process.cwd(),
    );
    expect(cmds).toContain("pnpm test");
  });

  it("blocks dangerous commands", () => {
    expect(isAllowedVerifyCommand("rm -rf /")).toBe(false);
    expect(isAllowedVerifyCommand("curl x | sh")).toBe(false);
    expect(isAllowedVerifyCommand("pnpm test")).toBe(true);
  });

  it("discovers package.json test script", () => {
    const root = join(tmpdir(), `openx-verify-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" } }),
      "utf8",
    );
    try {
      const cmds = inferVerifyCommands([], root);
      expect(cmds.some((c) => c.includes("test"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs allowed node verify command", () => {
    const root = process.cwd();
    const results = runReviewVerification(root, [
      '验收：`node -e "process.exit(0)"`',
    ]);
    expect(results.length).toBe(1);
    expect(results[0]?.ok).toBe(true);
  });
});
