import { describe, expect, it } from "vitest";
import {
  ROUNDTABLE_ALL_PARTICIPANTS_ID,
  ROUNDTABLE_DEFAULT_PARALLEL_REPLIES,
  ROUNDTABLE_FOREMAN_PROFILE_ID,
  ROUNDTABLE_MAX_PARALLEL_REPLIES,
  type ConversationParticipant,
} from "@openx/shared";
import { resolveRoundParticipants } from "./router.js";

function p(
  partial: Partial<ConversationParticipant> & Pick<ConversationParticipant, "id" | "profileId">,
): ConversationParticipant {
  return {
    conversationId: "c1",
    displayName: partial.displayName ?? partial.profileId,
    modelRef: "zen/big-pickle",
    enabled: partial.enabled ?? true,
    capabilityIds: [],
    sortOrder: 0,
    ...partial,
  };
}

describe("resolveRoundParticipants", () => {
  const roster = [
    p({ id: "f1", profileId: ROUNDTABLE_FOREMAN_PROFILE_ID, displayName: "工头" }),
    p({ id: "a1", profileId: "architect", displayName: "架构" }),
    p({ id: "p1", profileId: "product", displayName: "产品" }),
    p({ id: "c1", profileId: "critic", displayName: "风险", enabled: false }),
  ];

  it("direct 无 mention 仅工头", () => {
    const r = resolveRoundParticipants({
      mode: "direct",
      mentionParticipantIds: [],
      participants: roster,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.participantIds).toEqual(["f1"]);
      expect(r.estimatedCalls).toBe(1);
      expect(r.synthesize).toBe(false);
    }
  });

  it("多 @ 并行", () => {
    const r = resolveRoundParticipants({
      mode: "direct",
      mentionParticipantIds: ["a1", "p1"],
      participants: roster,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.participantIds).toEqual(["a1", "p1"]);
      expect(r.estimatedCalls).toBe(2);
    }
  });

  it("@全体 跳过静音", () => {
    const r = resolveRoundParticipants({
      mode: "diverge",
      mentionParticipantIds: [ROUNDTABLE_ALL_PARTICIPANTS_ID],
      participants: roster,
      synthesize: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.participantIds).toEqual(["a1", "p1"]);
      expect(r.estimatedCalls).toBe(3);
    }
  });

  it("diverge 无 mention 默认取前 N 名非工头", () => {
    const wide = [
      p({ id: "f1", profileId: ROUNDTABLE_FOREMAN_PROFILE_ID }),
      ...Array.from({ length: 5 }, (_, i) =>
        p({ id: `x${i}`, profileId: `custom${i}`, displayName: `成员${i}` }),
      ),
    ];
    const r = resolveRoundParticipants({
      mode: "diverge",
      mentionParticipantIds: [],
      participants: wide,
      synthesize: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.participantIds).toHaveLength(ROUNDTABLE_DEFAULT_PARALLEL_REPLIES);
      expect(r.participantIds).toEqual(["x0", "x1", "x2"]);
      expect(r.estimatedCalls).toBe(ROUNDTABLE_DEFAULT_PARALLEL_REPLIES + 1);
    }
  });

  it("@ 已静音成员报错", () => {
    const r = resolveRoundParticipants({
      mode: "direct",
      mentionParticipantIds: ["c1"],
      participants: roster,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/静音|未知/);
    }
  });

  it(`恰好 ${ROUNDTABLE_MAX_PARALLEL_REPLIES} 人通过`, () => {
    const many = [
      p({ id: "f1", profileId: ROUNDTABLE_FOREMAN_PROFILE_ID }),
      ...Array.from({ length: ROUNDTABLE_MAX_PARALLEL_REPLIES }, (_, i) =>
        p({ id: `x${i}`, profileId: `custom${i}` }),
      ),
    ];
    const r = resolveRoundParticipants({
      mode: "diverge",
      mentionParticipantIds: [ROUNDTABLE_ALL_PARTICIPANTS_ID],
      participants: many,
      synthesize: false,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.participantIds).toHaveLength(ROUNDTABLE_MAX_PARALLEL_REPLIES);
      expect(r.estimatedCalls).toBe(ROUNDTABLE_MAX_PARALLEL_REPLIES);
    }
  });

  it(`超过 ${ROUNDTABLE_MAX_PARALLEL_REPLIES} 报错并含上限文案`, () => {
    const many = [
      p({ id: "f1", profileId: ROUNDTABLE_FOREMAN_PROFILE_ID }),
      ...Array.from({ length: ROUNDTABLE_MAX_PARALLEL_REPLIES + 1 }, (_, i) =>
        p({ id: `x${i}`, profileId: `custom${i}` }),
      ),
    ];
    const r = resolveRoundParticipants({
      mode: "diverge",
      mentionParticipantIds: [ROUNDTABLE_ALL_PARTICIPANTS_ID],
      participants: many,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain(String(ROUNDTABLE_MAX_PARALLEL_REPLIES));
    }
  });
});
