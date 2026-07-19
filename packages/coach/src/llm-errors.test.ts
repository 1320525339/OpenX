import { describe, expect, it } from "vitest";
import {
  classifyCoachLlmError,
  describeLlmFailure,
  formatCoachLlmError,
  isCoachParseError,
  isCoachQuotaError,
} from "./llm-errors.js";

describe("formatCoachLlmError", () => {
  it("detects FreeUsageLimitError", () => {
    const err = { data: { responseBody: '{"type":"FreeUsageLimitError"}' } };
    expect(classifyCoachLlmError(err)).toBe("free_usage_limit");
    expect(isCoachQuotaError(err)).toBe(true);
    expect(formatCoachLlmError(err)).toContain("免费额度");
  });

  it("detects GoUsageLimitError", () => {
    const err = new Error("GoUsageLimitError: limit hit");
    expect(formatCoachLlmError(err)).toContain("Go");
  });

  it("detects JSON parse / NoObjectGeneratedError", () => {
    const err = new Error("No object generated: could not parse the response.");
    expect(isCoachParseError(err)).toBe(true);
    expect(classifyCoachLlmError(err)).toBe("parse_failed");
    expect(formatCoachLlmError(err)).toContain("规则引擎兜底");
  });

  it("does not treat parse errors as quota errors", () => {
    const err = new Error("No object generated: could not parse the response.");
    expect(isCoachQuotaError(err)).toBe(false);
    expect(classifyCoachLlmError(err)).toBe("parse_failed");
  });
});

describe("describeLlmFailure", () => {
  it("maps invalid API key", () => {
    const err = {
      message: "Invalid API Key",
      responseBody: '{"error":{"code":"401","type":"invalid_key"}}',
    };
    expect(describeLlmFailure(err)).toContain("鉴权失败");
  });

  it("maps No output generated", () => {
    expect(
      describeLlmFailure(
        new Error("No output generated. Check the stream for errors."),
      ),
    ).toContain("未返回可用正文");
  });

  it("maps TimeoutError name to timeout copy", () => {
    const err = new Error("模型响应超时");
    err.name = "TimeoutError";
    expect(describeLlmFailure(err)).toContain("超时");
  });

  it("maps AbortError / This operation was aborted to cancel copy", () => {
    const err = new Error("This operation was aborted");
    err.name = "AbortError";
    expect(describeLlmFailure(err)).toContain("已取消");
    expect(describeLlmFailure(err)).not.toContain("This operation was aborted");
  });

  it("maps explicit timeout message", () => {
    expect(describeLlmFailure(new Error("模型响应超时，请稍后重试或更换模型。"))).toContain(
      "超时",
    );
  });

  it("falls back to Error.message", () => {
    expect(describeLlmFailure(new Error("upstream 503"))).toContain("upstream 503");
  });
});
