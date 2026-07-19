import { NoOutputGeneratedError } from "ai";

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
const ABORT_MSG = "生成已取消或已停止。";

/** 用户停止 / AbortSignal 中止（含 undici「This operation was aborted」） */
export function isAbortError(err: unknown): boolean {
  if (typeof DOMException !== "undefined" && err instanceof DOMException) {
    if (err.name === "AbortError") return true;
  }
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError") return true;
  return /this operation was aborted|the operation was aborted/i.test(err.message);
}

export function isCoachTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "TimeoutError") return true;
  // AbortSignal.reason 可能是 TimeoutError
  const reason = (err as Error & { cause?: unknown }).cause;
  if (reason instanceof Error && reason.name === "TimeoutError") return true;
  if (
    typeof DOMException !== "undefined" &&
    err instanceof DOMException &&
    err.name === "AbortError"
  ) {
    // undici 等会把 abort(reason) 包成 AbortError，检查 message / reason
    if (/timed out|timeout|响应超时|模型响应超时/i.test(err.message)) return true;
  }
  // 纯 AbortError 视为取消，不与超时混淆
  if (isAbortError(err) && !/timed out|timeout|响应超时|模型响应超时/i.test(err.message)) {
    return false;
  }
  return /timed out|timeout|响应超时|模型响应超时/i.test(err.message);
}

export function formatCoachTimeoutError(): string {
  return TIMEOUT_MSG;
}

export function formatAbortError(): string {
  return ABORT_MSG;
}

/** 圆桌等场景：始终给出可读失败文案（含鉴权/限流/网络） */
export function describeLlmFailure(err: unknown): string {
  const special = formatCoachLlmError(err);
  if (special) return special;
  if (isCoachTimeoutError(err)) return formatCoachTimeoutError();
  if (isAbortError(err)) return formatAbortError();

  const text = collectErrorText(err);
  if (
    /invalid.?api.?key|invalid_key|401|unauthorized|authentication|鉴权/i.test(
      text,
    )
  ) {
    return "模型服务商鉴权失败（API Key 无效或过期），请在设置中检查密钥后重试。";
  }
  if (/403|forbidden|permission/i.test(text)) {
    return "模型服务商拒绝访问（权限不足），请检查账号或模型权限。";
  }
  if (/429|rate.?limit|too many requests|限流/i.test(text)) {
    return "模型服务商限流，请稍后重试。";
  }
  if (
    NoOutputGeneratedError.isInstance(err) ||
    /No output generated|Check the stream for errors/i.test(text)
  ) {
    return "模型未返回可用正文（可能工具调用异常或空响应），请重试或更换模型。";
  }
  if (
    /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|network|socket/i.test(
      text,
    )
  ) {
    return "无法连接模型服务商，请检查网络或 Base URL。";
  }
  if (/模型响应超时|响应超时/.test(text)) {
    return text.includes("模型响应超时")
      ? text
      : "模型响应超时，请稍后重试或更换模型。";
  }

  const msg = err instanceof Error ? err.message.trim() : "";
  if (msg) return `模型调用失败：${msg.slice(0, 240)}`;
  return "模型调用失败";
}
