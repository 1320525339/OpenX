import { describe, expect, it } from "vitest";
import { canTransition, GOAL_STATUS_LABELS, GoalStatusSchema } from "./goal.js";

describe("canTransition", () => {
  it("allows draft -> running", () => {
    expect(canTransition("draft", "running")).toBe(true);
  });

  it("allows running -> awaiting_review", () => {
    expect(canTransition("running", "awaiting_review")).toBe(true);
  });

  it("allows awaiting_review -> done", () => {
    expect(canTransition("awaiting_review", "done")).toBe(true);
  });

  it("allows awaiting_review -> running (rework restart)", () => {
    expect(canTransition("awaiting_review", "running")).toBe(true);
  });

  it("disallows done -> running", () => {
    expect(canTransition("done", "running")).toBe(false);
  });

  it("disallows draft -> done", () => {
    expect(canTransition("draft", "done")).toBe(false);
  });

  it("allows failed -> running for retry", () => {
    expect(canTransition("failed", "running")).toBe(true);
  });
});

describe("GOAL_STATUS_LABELS", () => {
  it("has label for every status", () => {
    for (const s of GoalStatusSchema.options) {
      expect(GOAL_STATUS_LABELS[s]).toBeTruthy();
    }
  });
});
