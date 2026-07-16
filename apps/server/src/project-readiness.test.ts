import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditProjectReadiness, readinessBadgeLabel } from "./project-readiness.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("auditProjectReadiness", () => {
  it("scores OpenX workspace as at least partial", () => {
    const report = auditProjectReadiness(repoRoot);
    expect(report.checks.length).toBeGreaterThanOrEqual(4);
    expect(["ready", "partial"]).toContain(report.level);
    expect(report.score).toBeGreaterThan(0);
    expect(readinessBadgeLabel(report.level)).toBeTruthy();
  });

  it("marks empty dir as missing/unknown", () => {
    const report = auditProjectReadiness("/tmp/openx-nonexistent-readiness-xyz");
    expect(report.level === "missing" || report.level === "unknown").toBe(true);
    expect(report.gaps.length).toBeGreaterThan(0);
  });
});
