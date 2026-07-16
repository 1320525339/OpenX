import { describe, expect, it } from "vitest";
import {
  attentionKeyForPayload,
  islandDurabilityForKind,
  isDurableIslandKind,
  islandSeverityRank,
  DynamicIslandPayloadSchema,
  IslandPushGoalRequestSchema,
} from "./index.js";

describe("attention / island durability", () => {
  it("durable kinds 映射正确", () => {
    expect(isDurableIslandKind("goal.awaiting_review")).toBe(true);
    expect(isDurableIslandKind("goal.failed")).toBe(true);
    expect(isDurableIslandKind("goal.done")).toBe(false);
    expect(islandDurabilityForKind("broadcast")).toBe("transient");
  });

  it("attentionKeyForPayload 稳定", () => {
    expect(
      attentionKeyForPayload({
        id: "x",
        kind: "goal.awaiting_review",
        severity: "info",
        title: "t",
        message: "m",
        goalId: "g1",
      }),
    ).toBe("goal.awaiting_review:g1");
  });

  it("severity rank", () => {
    expect(islandSeverityRank("error")).toBeLessThan(islandSeverityRank("info"));
  });

  it("schema 拒绝过长 id / goal 缺 goalId", () => {
    expect(
      DynamicIslandPayloadSchema.safeParse({
        id: "a".repeat(200),
        kind: "broadcast",
        title: "t",
        message: "m",
      }).success,
    ).toBe(false);
    expect(
      DynamicIslandPayloadSchema.safeParse({
        id: "ok",
        kind: "goal.failed",
        title: "t",
        message: "m",
      }).success,
    ).toBe(false);
  });

  it("IslandPushGoalRequestSchema", () => {
    expect(
      IslandPushGoalRequestSchema.safeParse({
        goalId: "g1",
        eventType: "awaiting_review",
      }).success,
    ).toBe(true);
  });
});
