import { describe, expect, it } from "vitest";
import { resolveSubGoalDependsOn } from "./sub-goal-deps.js";

describe("resolveSubGoalDependsOn", () => {
  const created = ["a", "b", "c"];

  it("chains by default after first item", () => {
    expect(resolveSubGoalDependsOn(0, [{}, {}], [], "parent")).toEqual([]);
    expect(resolveSubGoalDependsOn(1, [{}, {}], ["a"], "parent")).toEqual(["a"]);
  });

  it("honors dependsOnIndex for bug two-phase", () => {
    expect(
      resolveSubGoalDependsOn(
        1,
        [{}, { dependsOnIndex: [0] }],
        created,
        "parent",
      ),
    ).toEqual(["a"]);
  });

  it("supports explicit parallel scouts via empty dependsOnIndex", () => {
    expect(
      resolveSubGoalDependsOn(
        1,
        [{ dependsOnIndex: [] }, { dependsOnIndex: [] }],
        created,
        "parent",
      ),
    ).toEqual([]);
  });
});
