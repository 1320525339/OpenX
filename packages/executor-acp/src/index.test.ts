import { describe, expect, it } from "vitest";
import type { ExecutorContext } from "@openx/executor-core";
import { acpExecutor } from "./index.js";
import { buildAcpTurnPrompt } from "./acp-prompt.js";

function minimalCtx(overrides: Partial<ExecutorContext> = {}): ExecutorContext {
  return {
    goal: {
      id: "g1",
      conversationId: "c1",
      title: "ACP 续跑",
      acceptance: "ok",
      executionPrompt: "实现功能",
      constraints: [],
      status: "running",
      progress: 10,
      executorId: "acp:codex",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    workspaceRoot: "/tmp/ws",
    settings: {},
    callbacks: {
      onProgress: async () => {},
      onLog: async () => {},
      onComplete: async () => {},
      onFail: async () => {},
    },
    ...overrides,
  } as ExecutorContext;
}

describe("acpExecutor", () => {
  it("registers as acp adapter", () => {
    expect(acpExecutor.id).toBe("acp");
    expect(acpExecutor.displayName).toContain("施工队");
  });
});

describe("buildAcpTurnPrompt", () => {
  it("injects resume transcript on loadSession/steer", () => {
    const transcript = "【续跑上下文 · OpenX 补偿注入】\n【工头↔施工队对话摘要】\n先读再写";
    const prompt = buildAcpTurnPrompt(
      minimalCtx({
        resumeTranscript: transcript,
        crewContinuationPrompt: "【开发商】按方案B继续",
      }),
      { resume: true, steer: true },
    );
    expect(prompt).toContain("续跑上下文");
    expect(prompt).toContain("先读再写");
    expect(prompt).toContain("【开发商】按方案B继续");
    expect(prompt.indexOf("续跑上下文")).toBeLessThan(prompt.indexOf("【开发商】"));
  });

  it("skips transcript on fresh newSession", () => {
    const prompt = buildAcpTurnPrompt(
      minimalCtx({
        resumeTranscript: "【续跑上下文】不应出现",
      }),
      { resume: false },
    );
    expect(prompt).not.toContain("不应出现");
    expect(prompt).toContain("实现功能");
  });
});
