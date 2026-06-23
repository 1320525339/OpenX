import { describe, expect, it } from "vitest";
import type { Goal } from "@openx/shared";
import { goalNeedsUserAttention } from "./goal-attention";

const base = {
  id: "g1",
  conversationId: "c1",
  executorId: "pi",
  title: "t",
  orderNo: 1,
  acceptance: "",
  executionPrompt: "",
  constraints: [],
  status: "running" as const,
  progress: 50,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("goalNeedsUserAttention", () => {
  it("includes running goals awaiting user decision", () => {
    const goal = { ...base, crewStatus: "awaiting_user" as const };
    expect(goalNeedsUserAttention(goal as Goal)).toBe(true);
  });

  it("ignores running goals under foreman control", () => {
    const goal = { ...base, crewStatus: "idle" as const };
    expect(goalNeedsUserAttention(goal as Goal)).toBe(false);
  });
});
