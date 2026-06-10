import { describe, expect, it } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ensureWorkspaceSkillsLink,
  getWorkspaceSkillsLinkStatus,
} from "./workspace-skills-link.js";

describe("workspace-skills-link", () => {
  it("reports not linked when global skills dir missing", () => {
    const ws = join(tmpdir(), `openx-ws-missing-${Date.now()}`);
    mkdirSync(ws, { recursive: true });
    const prev = process.env.OPENX_SKILLS_DIR;
    process.env.OPENX_SKILLS_DIR = join(ws, "nonexistent-skills");
    try {
      const status = getWorkspaceSkillsLinkStatus(ws);
      expect(status.linked).toBe(false);
      expect(status.error).toBeTruthy();
    } finally {
      if (prev === undefined) delete process.env.OPENX_SKILLS_DIR;
      else process.env.OPENX_SKILLS_DIR = prev;
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it("links workspace skills when global dir exists", () => {
    const root = join(tmpdir(), `openx-link-test-${Date.now()}`);
    const globalSkills = join(root, "global-skills");
    const workspace = join(root, "workspace");
    mkdirSync(globalSkills, { recursive: true });
    mkdirSync(workspace, { recursive: true });
    mkdirSync(join(globalSkills, "obscura-fetch"), { recursive: true });

    const prev = process.env.OPENX_SKILLS_DIR;
    process.env.OPENX_SKILLS_DIR = globalSkills;
    try {
      const result = ensureWorkspaceSkillsLink(workspace);
      expect(result.linked).toBe(true);
      expect(existsSync(join(workspace, ".openx", "skills"))).toBe(true);

      const again = getWorkspaceSkillsLinkStatus(workspace);
      expect(again.linked).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.OPENX_SKILLS_DIR;
      else process.env.OPENX_SKILLS_DIR = prev;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
