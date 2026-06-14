import { describe, expect, it } from "vitest";
import {
  appendReviewPlaybookToSystem,
  buildReviewPlaybook,
  formatReviewPlaybookFlow,
} from "./review-playbook.js";

describe("review-playbook", () => {
  it("builds three flows", () => {
    const pb = buildReviewPlaybook();
    expect(pb.flows.map((f) => f.id)).toEqual([
      "goal_review",
      "parent_review",
      "rollup",
    ]);
  });

  it("formats flow as markdown steps", () => {
    const pb = buildReviewPlaybook();
    const text = formatReviewPlaybookFlow(pb, "goal_review");
    expect(text).toContain("单目标自动验收");
    expect(text).toContain("1. **收集证据**");
  });

  it("appends playbook to system prompt", () => {
    const out = appendReviewPlaybookToSystem("base", "rollup");
    expect(out.startsWith("base")).toBe(true);
    expect(out).toContain("父目标汇总");
  });
});
