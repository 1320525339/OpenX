import { describe, expect, it } from "vitest";
import { isAllowedApiPath, normalizeApiPath, substitutePathParams } from "./client.js";

describe("openx api client helpers", () => {
  it("normalizes paths", () => {
    expect(normalizeApiPath("api/goals")).toBe("/api/goals");
    expect(normalizeApiPath("/api/health")).toBe("/api/health");
  });

  it("allows only api and internal prefixes", () => {
    expect(isAllowedApiPath("/api/goals")).toBe(true);
    expect(isAllowedApiPath("/internal/goals/x/log")).toBe(true);
    expect(isAllowedApiPath("/evil")).toBe(false);
  });

  it("substitutes path params", () => {
    expect(substitutePathParams("/api/goals/:id/start", { id: "g1" })).toBe(
      "/api/goals/g1/start",
    );
    expect(substitutePathParams("/internal/goals/{goalId}/log", { goalId: "g2" })).toBe(
      "/internal/goals/g2/log",
    );
  });
});
