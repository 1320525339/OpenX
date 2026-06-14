import { describe, expect, it } from "vitest";
import { canMutateGoal, goalMutationDeniedMessage } from "./goal-access.js";
import { formatWorkOrderId, parseWorkOrderId } from "./goal-work-order.js";

describe("formatWorkOrderId", () => {
  it("pads order number", () => {
    expect(formatWorkOrderId(42)).toBe("WO-000042");
  });
});

describe("parseWorkOrderId", () => {
  it("parses WO label", () => {
    expect(parseWorkOrderId("WO-000042")).toBe(42);
  });
});

describe("canMutateGoal", () => {
  const goal = { conversationId: "c1" };

  it("console can mutate any", () => {
    expect(canMutateGoal({ type: "console" }, goal)).toBe(true);
  });

  it("conversation can mutate own", () => {
    expect(canMutateGoal({ type: "conversation", conversationId: "c1" }, goal)).toBe(true);
  });

  it("conversation cannot mutate others", () => {
    expect(canMutateGoal({ type: "conversation", conversationId: "c2" }, goal)).toBe(false);
  });

  it("deny message", () => {
    expect(goalMutationDeniedMessage()).toContain("无权");
  });
});
