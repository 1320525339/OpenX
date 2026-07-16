import { describe, expect, it } from "vitest";
import {
  mapIntegrationRunToTraceStatus,
  resolveIntegrationRunTraceStatus,
} from "./integration-run.js";

describe("integration run trace status", () => {
  it("does not treat needs_attention as done by default", () => {
    expect(mapIntegrationRunToTraceStatus("needs_attention")).toBe("in_progress");
    expect(mapIntegrationRunToTraceStatus("succeeded")).toBe("done");
    expect(mapIntegrationRunToTraceStatus("failed")).toBe("unknown");
    expect(mapIntegrationRunToTraceStatus("running")).toBe("in_progress");
  });

  it("keeps needs_attention in_progress while linked goal is still executing", () => {
    expect(resolveIntegrationRunTraceStatus("needs_attention", null)).toBe("in_progress");
    expect(resolveIntegrationRunTraceStatus("needs_attention", "running")).toBe("in_progress");
    expect(resolveIntegrationRunTraceStatus("needs_attention", "draft")).toBe("in_progress");
  });

  it("maps needs_attention to done/unknown after goal reaches a terminal review state", () => {
    expect(resolveIntegrationRunTraceStatus("needs_attention", "awaiting_review")).toBe("done");
    expect(resolveIntegrationRunTraceStatus("needs_attention", "done")).toBe("done");
    expect(resolveIntegrationRunTraceStatus("needs_attention", "failed")).toBe("unknown");
    expect(resolveIntegrationRunTraceStatus("needs_attention", "cancelled")).toBe("unknown");
  });
});
