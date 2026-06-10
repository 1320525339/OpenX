import { buildExecutionPrompt, type ExecutorAdapter } from "@openx/executor-core";

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
    ].join("\n");

    await callbacks.onComplete(summary);
  },

  cancel() {
    /* no-op */
  },
};
