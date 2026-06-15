import { describe, expect, it, vi } from "vitest";
import { mockExecutor } from "./index.js";
import type { Goal } from "@openx/shared";

const baseGoal: Goal = {
  id: "g1",
  orderNo: 1,
  conversationId: "c1",
  title: "测试",
  acceptance: "通过",
  executionPrompt: "做一件事",
  constraints: [],
  executorId: "mock",
  status: "running",
  progress: 0,
  dependsOn: [],
  priority: "medium",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe("mockExecutor", () => {
  it("completes with summary", async () => {
    const onComplete = vi.fn();
    const onFail = vi.fn();
    await mockExecutor.run({
      goal: baseGoal,
      workspaceRoot: process.cwd(),
      settings: {},
      callbacks: {
        onProgress: vi.fn(),
        onLog: vi.fn(),
        onComplete,
        onFail,
      },
    });
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onFail).not.toHaveBeenCalled();
  });
});
