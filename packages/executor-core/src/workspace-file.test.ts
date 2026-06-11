import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { readWorkspaceFileBaseline } from "./workspace-file.js";

describe("workspace-file", () => {
  it("reads baseline from workspace-relative path", () => {
    const dir = mkdtempSync(join(tmpdir(), "openx-ws-"));
    try {
      writeFileSync(join(dir, "a.txt"), "hello");
      const text = readWorkspaceFileBaseline(dir, "a.txt");
      expect(text).toBe("hello");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns undefined for missing file", () => {
    const dir = mkdtempSync(join(tmpdir(), "openx-ws-"));
    try {
      expect(readWorkspaceFileBaseline(dir, "missing.txt")).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
