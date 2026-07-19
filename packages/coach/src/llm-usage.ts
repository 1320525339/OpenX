/**
 * LLM usage 埋点：Coach 包内不依赖 DB，由 server 注册 sink。
 */
export type LlmUsageEvent = {
  role?: "coach" | "pi" | "reviewer" | "unknown";
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

type LlmUsageSink = (event: LlmUsageEvent) => void;

let sink: LlmUsageSink | undefined;

export function registerLlmUsageSink(next: LlmUsageSink | undefined): void {
  sink = next;
}

export function recordLlmUsage(event: LlmUsageEvent): void {
  try {
    sink?.(event);
  } catch (err) {
    console.warn("[coach] llm usage sink failed:", err);
  }
}

/** 从 AI SDK 结果提取 usage（兼容不同字段命名） */
export function extractUsageFromResult(result: {
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}): Pick<LlmUsageEvent, "inputTokens" | "outputTokens" | "totalTokens"> | null {
  const u = result.usage;
  if (!u) return null;
  const inputTokens = u.inputTokens ?? u.promptTokens;
  const outputTokens = u.outputTokens ?? u.completionTokens;
  const totalTokens =
    u.totalTokens ??
    (typeof inputTokens === "number" && typeof outputTokens === "number"
      ? inputTokens + outputTokens
      : undefined);
  if (
    typeof inputTokens !== "number" &&
    typeof outputTokens !== "number" &&
    typeof totalTokens !== "number"
  ) {
    return null;
  }
  return { inputTokens, outputTokens, totalTokens };
}
