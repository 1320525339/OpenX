import { describe, expect, it } from "vitest";
import {
  defaultMilocoSkillBindings,
  laneToEventLabel,
  mapGoalStatusToTraceStatus,
  mapGoalStatusToTurnStatus,
  MILOCO_BATCH1_SKILL_IDS,
  MILOCO_BATCH2_ONLY_SKILL_IDS,
  MILOCO_BATCH3_ONLY_SKILL_IDS,
  MILOCO_PROACTIVE_SKILL_IDS,
  MILOCO_SYNC_SKILL_IDS,
  milocoCliCommandPrefix,
  milocoWebhookUrl,
} from "./miloco.js";
import { defaultSkillCatalog } from "./skills.js";

describe("miloco integration", () => {
  it("builds wsl wrapper prefix", () => {
    const prefix = milocoCliCommandPrefix("C:/Demo/OpenX");
    expect(prefix).toContain("miloco-wsl.ps1");
  });

  it("builds webhook url", () => {
    expect(milocoWebhookUrl()).toBe("http://127.0.0.1:3921/api/miloco/webhook");
  });

  it("maps lane labels", () => {
    expect(laneToEventLabel("miloco-suggest")).toBe("感知建议");
    expect(laneToEventLabel("unknown")).toBe("unknown");
  });

  it("has empty default presence dids and lane policies", async () => {
    const {
      DEFAULT_MILOCO_PRESENCE_WATCH_DIDS,
      resolveMilocoLanePolicy,
      milocoSkillAllowedForLane,
      milocoMessageNeedsEscalation,
    } = await import("./miloco.js");
    expect(DEFAULT_MILOCO_PRESENCE_WATCH_DIDS).toEqual([]);
    expect(resolveMilocoLanePolicy("miloco-suggest").permissionMode).toBe("read_only");
    expect(milocoSkillAllowedForLane("miloco-suggest", "miloco-terminate-task")).toBe(false);
    expect(milocoMessageNeedsEscalation("请删除全部设备")).toBe(true);
  });

  it("maps goal status to turn status", () => {
    expect(mapGoalStatusToTurnStatus("awaiting_review")).toBe("ok");
    expect(mapGoalStatusToTurnStatus("failed")).toBe("error");
    expect(mapGoalStatusToTurnStatus("running")).toBe("timeout");
  });

  it("maps goal status to trace status", () => {
    expect(mapGoalStatusToTraceStatus("done")).toBe("done");
    expect(mapGoalStatusToTraceStatus("running")).toBe("in_progress");
    expect(mapGoalStatusToTraceStatus("failed")).toBe("unknown");
  });

  it("default bindings enable proactive skills for pi", () => {
    const bindings = defaultMilocoSkillBindings();
    for (const id of MILOCO_PROACTIVE_SKILL_IDS) {
      expect(bindings[id]?.enabled).toBe(true);
      expect(bindings[id]?.cliIds).toContain("pi");
    }
    for (const id of MILOCO_BATCH1_SKILL_IDS) {
      expect(bindings[id]?.enabled).toBe(true);
    }
  });

  it("default bindings enable batch2 and sync skills for pi", () => {
    const bindings = defaultMilocoSkillBindings();
    for (const id of MILOCO_SYNC_SKILL_IDS) {
      expect(bindings[id]?.enabled).toBe(true);
      expect(bindings[id]?.cliIds).toContain("pi");
    }
    expect(MILOCO_SYNC_SKILL_IDS).toHaveLength(16);
    expect(MILOCO_BATCH2_ONLY_SKILL_IDS).toHaveLength(4);
    expect(MILOCO_BATCH3_ONLY_SKILL_IDS).toHaveLength(7);
  });
});

describe("local skills in catalog", () => {
  it("includes manifest local skills", () => {
    const catalog = defaultSkillCatalog({
      version: 1,
      skills: {
        "miloco-devices": {
          id: "miloco-devices",
          dir: "miloco-devices",
          repo: "miloco-local",
          branch: "local",
          installedAt: new Date().toISOString(),
          skillMdPath: "/tmp/miloco-devices/SKILL.md",
          name: "miloco-devices",
          description: "devices",
        },
      },
    });
    expect(catalog.some((s) => s.id === "miloco-devices" && s.kind === "local")).toBe(
      true,
    );
  });
});
