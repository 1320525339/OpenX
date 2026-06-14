import { describe, expect, it } from "vitest";
import {
  enforceBugTwoPhaseSubGoals,
  isBugOrAnomalyReport,
  shouldEnforceBugTwoPhase,
} from "./bug-dispatch.js";
import type { RefinedGoal } from "./coach.js";

describe("bug-dispatch", () => {
  it("detects bug-like reports", () => {
    expect(isBugOrAnomalyReport("登录按钮点了没反应")).toBe(true);
    expect(isBugOrAnomalyReport("帮我设计一个游戏")).toBe(false);
  });

  it("forces two-phase subGoals for bug reports", () => {
    const base: RefinedGoal = {
      title: "登录失败",
      acceptance: "可正常登录",
      executionPrompt: "修复登录",
      constraints: [],
    };
    const out = enforceBugTwoPhaseSubGoals(base, "登录报错 500");
    expect(out.subGoals).toHaveLength(2);
    expect(out.subGoals![0]!.title).toMatch(/阶段一|侦察/);
    expect(out.subGoals![1]!.title).toMatch(/阶段二|修复/);
    expect(out.subGoals![1]!.dependsOnIndex).toEqual([0]);
    expect(out.subGoals![0]!.permissionMode).toBe("read_only");
  });

  it("skips when recon subGoal already present", () => {
    const withRecon: RefinedGoal = {
      title: "x",
      acceptance: "y",
      executionPrompt: "z",
      constraints: [],
      subGoals: [
        {
          title: "只读侦察",
          acceptance: "报告",
          executionPrompt: "查证据",
        },
        {
          title: "修复",
          acceptance: "通过",
          executionPrompt: "改代码",
        },
      ],
    };
    expect(shouldEnforceBugTwoPhase(withRecon, "登录 bug")).toBe(false);
  });
});
