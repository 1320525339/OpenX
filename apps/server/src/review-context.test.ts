import { describe, expect, it } from "vitest";
import type { Goal } from "@openx/shared";
import { summarizeDeliverables } from "./review-context.js";

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  const now = new Date().toISOString();
  return {
    id: "g1",
    conversationId: "c1",
    title: "测试",
    acceptance: "通过",
    executionPrompt: "做",
    constraints: [],
    executorId: "pi",
    status: "awaiting_review",
    progress: 100,
    dependsOn: [],
    priority: "medium",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("review-context", () => {
  it("summarizeDeliverables lists structured files", () => {
    const goal = makeGoal({
      deliverables: [
        { kind: "file", path: "src/auth.ts", action: "created" },
        { kind: "link", url: "https://example.com", label: "demo" },
      ],
    });
    const summary = summarizeDeliverables(goal);
    expect(summary).toContain("src/auth.ts");
    expect(summary).toContain("https://example.com");
  });
});
