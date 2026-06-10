import { describe, expect, it } from "vitest";
import {
  classifyCoachLlmError,
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
