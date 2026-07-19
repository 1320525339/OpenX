import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROUNDTABLE_PROFILE_IDS,
  ROUNDTABLE_FOREMAN_PROFILE_ID,
  ROUNDTABLE_GENERAL_PROFILE_ID,
  ROUNDTABLE_MAX_PARALLEL_REPLIES,
  CreateChatRoundSchema,
  pickChatRoundComposerContext,
  buildRoundtableModelPool,
  shortModelRefLabel,
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

  it("含通用席位画像 id", () => {
    expect(ROUNDTABLE_GENERAL_PROFILE_ID).toBe("general");
  });

  it("buildRoundtableModelPool 去重且 coach 优先", () => {
    const pool = buildRoundtableModelPool({
      model: {
        coach: "a/coach",
        default: "a/default",
        pi: "a/pi",
      },
      providers: {
        a: {
          name: "A",
          api: { type: "openai-compatible", baseUrl: "http://x" },
          models: {
            coach: { name: "coach" },
            default: { name: "default" },
            extra: { name: "extra" },
          },
        },
      },
    });
    expect(pool[0]).toBe("a/coach");
    expect(pool).toContain("a/default");
    expect(pool).toContain("a/extra");
    expect(new Set(pool).size).toBe(pool.length);
  });

  it("shortModelRefLabel 取短名", () => {
    expect(shortModelRefLabel("zen/big-pickle")).toBe("big-pickle");
  });
});

describe("CreateChatRoundSchema composer context", () => {
  it("解析 skillIds/mcpIds/knowledge/permissionMode", () => {
    const parsed = CreateChatRoundSchema.parse({
      message: "讨论一下",
      skillIds: ["shell"],
      mcpIds: ["openx"],
      knowledge: { mode: "all" },
      permissionMode: "read_only",
    });
    expect(parsed.skillIds).toEqual(["shell"]);
    expect(parsed.mcpIds).toEqual(["openx"]);
    expect(parsed.knowledge).toEqual({ mode: "all" });
    expect(parsed.permissionMode).toBe("read_only");
  });

  it("pickChatRoundComposerContext 空输入返回 undefined", () => {
    expect(pickChatRoundComposerContext({})).toBeUndefined();
  });

  it("pickChatRoundComposerContext 提取非空字段", () => {
    expect(
      pickChatRoundComposerContext({
        skillIds: ["a"],
        permissionMode: "full",
      }),
    ).toEqual({ skillIds: ["a"], permissionMode: "full" });
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

  it("显式 participant 与缺少 speakerId 时 unknown", () => {
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
