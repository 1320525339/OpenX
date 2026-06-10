import { describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_SETTINGS } from "@openx/shared";
import { resolveGoalExecutorId } from "./executor-recommend-service.js";

function withTempSkillsDir(run: (skillsDir: string) => Promise<void> | void) {
  const root = join(tmpdir(), `openx-rec-test-${Date.now()}`);
  const skillsDir = join(root, "skills");
  mkdirSync(join(skillsDir, "obscura-fetch"), { recursive: true });
  writeFileSync(join(skillsDir, "obscura-fetch", "SKILL.md"), "---\nname: fetch\n---\n");
  writeFileSync(
    join(skillsDir, "manifest.json"),
    JSON.stringify({
      version: 1,
      skills: {
        "obscura-fetch": {
          id: "obscura-fetch",
          dir: "obscura-fetch",
          repo: "obscura-plugin",
          branch: "main",
          installedAt: new Date().toISOString(),
          skillMdPath: "obscura-fetch/SKILL.md",
        },
      },
    }),
  );

  const prev = process.env.OPENX_SKILLS_DIR;
  process.env.OPENX_SKILLS_DIR = skillsDir;
  try {
    return run(skillsDir);
  } finally {
    if (prev === undefined) delete process.env.OPENX_SKILLS_DIR;
    else process.env.OPENX_SKILLS_DIR = prev;
    rmSync(root, { recursive: true, force: true });
  }
}

describe("resolveGoalExecutorId", () => {
  const executors = [
    { id: "pi", available: true },
    { id: "my-agent", available: true },
  ];

  it("recommends connect agent for web goal when using default executor", async () => {
    await withTempSkillsDir(async () => {
      const settings = {
        ...DEFAULT_SETTINGS,
        defaultExecutorId: "pi",
        cliProfiles: [
          {
            executorId: "my-agent",
            displayName: "My Agent",
            kind: "connect" as const,
            addedAt: new Date().toISOString(),
          },
        ],
        skillBindings: {
          "obscura-fetch": { enabled: true, cliIds: ["my-agent"] },
        },
      };

      const result = await resolveGoalExecutorId(
        {
          title: "抓取 https://example.com 页面",
          executorId: "pi",
        },
        settings,
        executors,
      );

      expect(result.executorId).toBe("my-agent");
      expect(result.recommendReason).toBeTruthy();
    });
  });

  it("keeps explicit non-default executor", async () => {
    await withTempSkillsDir(async () => {
      const settings = {
        ...DEFAULT_SETTINGS,
        defaultExecutorId: "pi",
        cliProfiles: [
          {
            executorId: "my-agent",
            displayName: "My Agent",
            kind: "connect" as const,
            addedAt: new Date().toISOString(),
          },
        ],
        skillBindings: {
          "obscura-fetch": { enabled: true, cliIds: ["my-agent"] },
        },
      };

      const result = await resolveGoalExecutorId(
        {
          title: "抓取 https://example.com 页面",
          executorId: "my-agent",
        },
        settings,
        executors,
      );

      expect(result.executorId).toBe("my-agent");
      expect(result.recommendReason).toBeUndefined();
    });
  });
});
