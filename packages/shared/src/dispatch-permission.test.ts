import { describe, expect, it } from "vitest";
import { buildDispatchPermissionBlock } from "./dispatch-context.js";
import { buildExecutionPrompt } from "./execution-prompt.js";
import type { Goal } from "./goal.js";

function makeGoal(dispatchContext?: Goal["dispatchContext"]): Goal {
  const now = new Date().toISOString();
  return {
    id: "g1",
    orderNo: 1,
    conversationId: "c1",
    title: "侦察",
    acceptance: "提交报告",
    executionPrompt: "调查登录问题",
    constraints: [],
    executorId: "pi",
    status: "running",
    progress: 0,
    dependsOn: [],
    priority: "medium",
    dispatchContext,
    createdAt: now,
    updatedAt: now,
  };
}

describe("dispatch permission in execution prompt", () => {
  it("injects read_only block", () => {
    const prompt = buildExecutionPrompt(
      makeGoal({ permissionMode: "read_only" }),
    );
    expect(prompt).toContain("只读侦察");
    expect(prompt).toContain("禁止创建、修改、删除");
  });

  it("buildDispatchPermissionBlock returns undefined for full", () => {
    expect(buildDispatchPermissionBlock("full")).toContain("完全授权");
  });
});
