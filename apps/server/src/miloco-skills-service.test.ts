import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ALL_SYNC_IDS = [
  "miloco-devices",
  "miloco-miot-scope",
  "miloco-miot-admin",
  "miloco-notify",
  "miloco-perception",
  "miloco-create-task",
  "miloco-terminate-task",
  "miloco-miot-identity",
  "miloco-miot-identity-register",
  "miloco-home-profile",
  "miloco-perception-digest",
  "miloco-home-patrol",
  "miloco-home-observe",
  "miloco-home-promote",
  "miloco-home-prune",
  "miloco-habit-suggest",
];

describe("syncMilocoSkills", () => {
  let skillsDir: string;
  let milocoSrc: string;
  let prevSkillsDir: string | undefined;

  beforeEach(() => {
    skillsDir = mkdtempSync(join(tmpdir(), "openx-skills-"));
    milocoSrc = mkdtempSync(join(tmpdir(), "miloco-src-"));
    prevSkillsDir = process.env.OPENX_SKILLS_DIR;
    process.env.OPENX_SKILLS_DIR = skillsDir;
    process.env.OPENX_MILOCO_SKILLS_SRC = milocoSrc;

    for (const id of ALL_SYNC_IDS) {
      const dir = join(milocoSrc, id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "SKILL.md"),
        `---\nname: ${id}\ndescription: test ${id}\n---\n\n# ${id}\n\nRun miloco-cli device list\n`,
        "utf8",
      );
    }
  });

  afterEach(() => {
    if (prevSkillsDir === undefined) delete process.env.OPENX_SKILLS_DIR;
    else process.env.OPENX_SKILLS_DIR = prevSkillsDir;
    delete process.env.OPENX_MILOCO_SKILLS_SRC;
    rmSync(skillsDir, { recursive: true, force: true });
    rmSync(milocoSrc, { recursive: true, force: true });
  });

  it("installs all sync skills with openx adapter", async () => {
    const { syncMilocoSkills } = await import("./miloco-skills-service.js");
    const result = syncMilocoSkills(true);
    expect(result.ok).toBe(true);
    expect(result.installed).toHaveLength(ALL_SYNC_IDS.length);

    const adapted = join(skillsDir, "miloco-devices", "SKILL.md");
    const content = await import("node:fs").then((fs) =>
      fs.readFileSync(adapted, "utf8"),
    );
    expect(content).toContain("OpenX 执行约定");
    expect(content).toContain("miloco-wsl.ps1");

    const batch2 = join(skillsDir, "miloco-create-task", "SKILL.md");
    expect(content).toBeTruthy();
    const batch2Content = await import("node:fs").then((fs) =>
      fs.readFileSync(batch2, "utf8"),
    );
    expect(batch2Content).toContain("OpenX 执行约定");
  });
});
