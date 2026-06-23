import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ensureWorkspaceOpenxGitignore,
  OPENX_GITIGNORE_LINE,
} from "./workspace-gitignore.js";

describe("ensureWorkspaceOpenxGitignore", () => {
  it("creates .gitignore with .openx/ entry", () => {
    const dir = mkdtempSync(join(tmpdir(), "openx-gitignore-"));
    expect(ensureWorkspaceOpenxGitignore(dir)).toBe(true);
    const content = readFileSync(join(dir, ".gitignore"), "utf8");
    expect(content).toContain(OPENX_GITIGNORE_LINE);
    rmSync(dir, { recursive: true, force: true });
  });

  it("is idempotent when .openx/ already ignored", () => {
    const dir = mkdtempSync(join(tmpdir(), "openx-gitignore-"));
    ensureWorkspaceOpenxGitignore(dir);
    expect(ensureWorkspaceOpenxGitignore(dir)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
