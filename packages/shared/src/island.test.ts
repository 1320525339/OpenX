import { describe, expect, it } from "vitest";
import {
  ISLAND_DISMISS_ACTION,
  islandDedupeKey,
  withIslandDismissAction,
  type DynamicIslandPayload,
} from "./island.js";

function sample(overrides: Partial<DynamicIslandPayload> = {}): DynamicIslandPayload {
  return {
    id: "x-1",
    kind: "goal.awaiting_review",
    severity: "info",
    title: "T",
    message: "M",
    goalId: "g1",
    ...overrides,
  };
}

describe("withIslandDismissAction", () => {
  it("appends dismiss when missing", () => {
    const out = withIslandDismissAction(sample());
    expect(out.actions?.some((a) => a.action.type === "dismiss")).toBe(true);
    expect(out.actions?.at(-1)).toEqual(ISLAND_DISMISS_ACTION);
  });

  it("does not duplicate dismiss", () => {
    const out = withIslandDismissAction(
      sample({ actions: [ISLAND_DISMISS_ACTION] }),
    );
    expect(out.actions).toHaveLength(1);
  });
});

describe("islandDedupeKey", () => {
  it("returns kind:goalId for goal cards", () => {
    expect(islandDedupeKey(sample())).toBe("goal.awaiting_review:g1");
  });

  it("returns null for broadcast", () => {
    expect(islandDedupeKey(sample({ kind: "broadcast", goalId: undefined }))).toBeNull();
  });
});
