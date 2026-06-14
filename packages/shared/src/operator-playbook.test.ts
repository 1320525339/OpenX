import { describe, expect, it } from "vitest";
import { buildOperatorPlaybook } from "./operator-playbook.js";

describe("operator-playbook", () => {
  it("includes core flows", () => {
    const pb = buildOperatorPlaybook();
    const ids = pb.flows.map((f) => f.id);
    expect(ids).toContain("onboard_connect");
    expect(ids).toContain("add_model");
    expect(ids).toContain("goal_lifecycle");
    expect(pb.selfTestStepIds.length).toBeGreaterThan(3);
  });
});
