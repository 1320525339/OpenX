import { describe, expect, it } from "vitest";
import {
  evaluateGoalApprovalGate,
  evaluateGoalCompleteGate,
  isChildGoalComplete,
} from "./goal-gate.js";

describe("goal-gate", () => {
  it("treats waived child as complete", () => {
    expect(isChildGoalComplete({ status: "cancelled", waived: true })).toBe(true);
    expect(isChildGoalComplete({ status: "running", waived: false })).toBe(false);
  });

  it("blocks parent complete when child still open", () => {
    const result = evaluateGoalCompleteGate({
      children: [
        { id: "c1", title: "子任务 A", status: "done" },
        { id: "c2", title: "子任务 B", status: "running" },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons[0]?.code).toBe("child_not_complete");
    }
  });

  it("requires review pass for manual approve when autoReview is on", () => {
    const blocked = evaluateGoalApprovalGate({
      goal: {
        id: "g1",
        title: "主任务",
        autoReview: true,
        conversationId: "c1",
      },
      children: [],
      pendingClarifyIds: [],
      hasReviewPass: false,
      source: "user",
    });
    expect(blocked.ok).toBe(false);

    const autoOk = evaluateGoalApprovalGate({
      goal: {
        id: "g1",
        title: "主任务",
        autoReview: true,
        conversationId: "c1",
      },
      children: [],
      pendingClarifyIds: [],
      hasReviewPass: false,
      source: "auto",
    });
    expect(autoOk.ok).toBe(true);
  });

  it("blocks approve when clarify is pending", () => {
    const result = evaluateGoalApprovalGate({
      goal: {
        id: "g1",
        title: "主任务",
        autoReview: false,
        conversationId: "c1",
      },
      children: [],
      pendingClarifyIds: [42],
      hasReviewPass: false,
      source: "user",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reasons.some((r) => r.code === "pending_clarify")).toBe(true);
    }
  });
});
