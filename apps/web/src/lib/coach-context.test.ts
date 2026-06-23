import { afterEach, describe, expect, it } from "vitest";
import {
  COACH_MCPS,
  enabledSelectionIds,
  loadMcpSelection,
  loadPermissionSelection,
  loadSkillSelection,
  saveMcpSelection,
  savePermissionSelection,
  saveSkillSelection,
  type CoachMcp,
} from "./coach-context.js";

describe("coach-context persistence", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("loads MCP selection for full API catalog including openx", () => {
    const catalog: CoachMcp[] = [
      { id: "openx", name: "OpenX API", desc: "REST" },
      ...COACH_MCPS,
    ];
    saveMcpSelection({ openx: true, browser: true, workspace: false, filesystem: true });

    expect(loadMcpSelection(catalog)).toEqual({
      openx: true,
      browser: true,
      workspace: false,
      filesystem: true,
    });
    expect(enabledSelectionIds(loadMcpSelection(catalog))).toEqual([
      "openx",
      "browser",
      "filesystem",
    ]);
  });

  it("merges MCP saves without dropping ids missing from current catalog", () => {
    saveMcpSelection({ openx: true, browser: false });
    saveMcpSelection({ browser: true });

    expect(loadMcpSelection(COACH_MCPS)).toEqual({
      browser: true,
      workspace: false,
      filesystem: false,
    });
    expect(loadMcpSelection([{ id: "openx", name: "OpenX API", desc: "REST" }])).toEqual({
      openx: true,
    });
  });

  it("persists skill and permission selections", () => {
    saveSkillSelection({ filesystem: true, shell: false });
    savePermissionSelection("full");

    expect(loadSkillSelection()).toMatchObject({ filesystem: true, shell: false });
    expect(loadPermissionSelection()).toBe("full");
  });
});
