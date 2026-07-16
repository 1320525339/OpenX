import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROUNDTABLE_PROFILE_IDS,
  ROUNDTABLE_FOREMAN_PROFILE_ID,
  ROUNDTABLE_MAX_PARALLEL_REPLIES,
  legacyRoleToSpeakerType,
  speakerTypeToLegacyRole,
} from "./roundtable.js";
import { resolveTextSpeaker } from "./coach-messages.js";

describe("roundtable presets", () => {
  it("默认阵容含工头且锁定产品/架构/风险", () => {
    expect(DEFAULT_ROUNDTABLE_PROFILE_IDS).toEqual([
      ROUNDTABLE_FOREMAN_PROFILE_ID,
      "product",
      "architect",
      "critic",
    ]);
    expect(DEFAULT_ROUNDTABLE_PROFILE_IDS.length).toBeLessThanOrEqual(
      ROUNDTABLE_MAX_PARALLEL_REPLIES,
    );
  });
});

describe("speaker legacy compat", () => {
  it("role 回填 speakerType", () => {
    expect(legacyRoleToSpeakerType("user")).toBe("user");
    expect(legacyRoleToSpeakerType("coach")).toBe("foreman");
    expect(legacyRoleToSpeakerType("anything-else")).toBe("foreman");
    expect(speakerTypeToLegacyRole("participant")).toBe("coach");
    expect(speakerTypeToLegacyRole("foreman")).toBe("coach");
  });

  it("旧文本消息无 speaker 字段时 resolveTextSpeaker 兼容", () => {
    expect(resolveTextSpeaker({ role: "user" })).toEqual({
      speakerType: "user",
      speakerId: "user",
    });
    expect(resolveTextSpeaker({ role: "coach" })).toEqual({
      speakerType: "foreman",
      speakerId: "foreman",
    });
  });

  it("显式 participant 与缺失 speakerId 时 unknown", () => {
    expect(
      resolveTextSpeaker({
        role: "coach",
        speakerType: "participant",
        speakerId: "part-9",
      }),
    ).toEqual({ speakerType: "participant", speakerId: "part-9" });
    expect(
      resolveTextSpeaker({
        role: "coach",
        speakerType: "participant",
      }),
    ).toEqual({ speakerType: "participant", speakerId: "unknown" });
  });
});
