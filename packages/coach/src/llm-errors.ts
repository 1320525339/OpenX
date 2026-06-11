const FREE_USAGE_MSG =
  "OpenCode Zen 免费额度已用完。可稍后再试、在设置中换其他免费模型，或配置 OPENCODE_API_KEY / 自有 API Key。";

const GO_USAGE_MSG =
  "OpenCode Go 订阅额度已用尽。请在 opencode.ai 查看账单，或改用 Zen 免费模型 / 自有 Key。";

function collectErrorText(err: unknown): string {
  const parts: string[] = [];
  if (err instanceof Error) {
    parts.push(err.message);
    const cause = (err as Error & { cause?: unknown }).cause;
    if (cause) parts.push(collectErrorText(cause));
  }
  if (typeof err === "object" && err !== null) {
    const o = err as Record<string, unknown>;
    if (typeof o.responseBody === "string") parts.push(o.responseBody);
    if (typeof o.data === "object" && o.data !== null) {
      const d = o.data as Record<string, unknown>;
      if (typeof d.responseBody === "string") parts.push(d.responseBody);
      if (typeof d.message === "string") parts.push(d.message);
    }
    if (typeof o.message === "string") parts.push(o.message);
  }
  return parts.join("\n");
}

export type CoachLlmErrorKind =
  | "free_usage_limit"
  | "go_usage_limit"
  | "parse_failed"
  | null;

const PARSE_FAIL_MSG =
  "LLM 结构化 JSON 输出失败（模型返回空内容或格式无效），已改用规则引擎兜底。建议在设置中更换支持 JSON 输出的模型。";

function isNoObjectGenerated(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === "AI_NoObjectGeneratedError" ||
    /No object generated|could not parse the response|JSON parsing failed/i.test(
      err.message,
    )
  );
}

export function isCoachParseError(err: unknown): boolean {
  if (isNoObjectGenerated(err)) return true;
  const text = collectErrorText(err);
  return (
    /JSON parsing failed|Unexpected end of JSON input|could not parse the response|No object generated|结构化 JSON 输出失败/i.test(
      text,
    )
  );
}

export function classifyCoachLlmError(err: unknown): CoachLlmErrorKind {
  const text = collectErrorText(err);
  if (text.includes("FreeUsageLimitError") || text.includes("Free usage exceeded")) {
    return "free_usage_limit";
  }
  if (text.includes("GoUsageLimitError")) {
    return "go_usage_limit";
  }
  if (isCoachParseError(err)) {
    return "parse_failed";
  }
  return null;
}

export function formatCoachLlmError(err: unknown): string | null {
  const kind = classifyCoachLlmError(err);
  if (kind === "free_usage_limit") return FREE_USAGE_MSG;
  if (kind === "go_usage_limit") return GO_USAGE_MSG;
  if (kind === "parse_failed") return PARSE_FAIL_MSG;
  return null;
}

export function isCoachQuotaError(err: unknown): boolean {
  const kind = classifyCoachLlmError(err);
  return kind === "free_usage_limit" || kind === "go_usage_limit";
}

const TIMEOUT_MSG = "助手 LLM 响应超时，请稍后重试或更换模型。";

export function isCoachTimeoutError(err: unknown): boolean {
  if (err instanceof Error) {
    if (err.name === "AbortError") return true;
    if (/timed out|timeout|aborted/i.test(err.message)) return true;
  }
  return false;
}

export function formatCoachTimeoutError(): string {
  return TIMEOUT_MSG;
}
