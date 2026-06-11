import { buildExecutionPrompt, type ExecutorAdapter } from "@openx/executor-core";
import type { GoalDeliverable } from "@openx/shared";

/** 确定性测试执行器：不调用 LLM，快速完成 */
export const mockExecutor: ExecutorAdapter = {
  id: "mock",
  displayName: "Mock（测试）",

  async detect() {
    return { available: true, hint: "确定性测试执行器" };
  },

  async run(ctx) {
    const { goal, callbacks, priorLogs, enabledSkills, isRework } = ctx;
    const prompt = buildExecutionPrompt(goal, priorLogs ?? [], enabledSkills, {
      isRework,
      priorSummaries: ctx.priorSummaries,
      priorReviewRounds: ctx.priorReviewRounds,
    });

    await callbacks.onLog("info", "[mock] 测试执行器已接管");
    if (isRework) {
      await callbacks.onLog("warn", `[mock] 返工：${goal.reworkReason ?? "无原因"}`);
    }
    await callbacks.onProgress(40, "Mock 执行中…");
    await callbacks.onProgress(100, "Mock 完成");

    const summary = [
      `【Mock 完成】${goal.title}`,
      "",
      prompt.slice(0, 400),
      prompt.length > 400 ? "…" : "",
      "",
      "已修改 apps/web/src/App.tsx",
    ].join("\n");

    const deliverables: GoalDeliverable[] = [
      {
        kind: "file",
        path: "apps/web/src/App.tsx",
        label: "App.tsx",
        action: "modified",
        language: "tsx",
        previousContent: `// Mock 修改前\nexport function App() {\n  return <div>旧版</div>;\n}\n`,
        preview: `// Mock 交付预览\nexport function App() {\n  return <div>${goal.title}</div>;\n}\n`,
      },
      {
        kind: "snippet",
        language: "typescript",
        label: "示例片段",
        code: `const done = true; // ${goal.title}`,
      },
    ];

    await callbacks.onComplete(summary, deliverables);
  },

  cancel() {
    /* no-op */
  },
};
