import { describe, expect, it, beforeEach } from "vitest";
import { countGoalsByDisplay, listGoalsPage, listLogsPage } from "./db.js";

describe("goals pagination", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
  });

  it("returns paginated goals with total and hasMore", () => {
    const page = listGoalsPage({}, { limit: 10, offset: 0 });
    expect(page.limit).toBe(10);
    expect(page.offset).toBe(0);
    expect(Array.isArray(page.goals)).toBe(true);
    expect(page.total).toBeGreaterThanOrEqual(0);
    expect(typeof page.hasMore).toBe("boolean");
  });

  it("returns display filter counts", () => {
    const counts = countGoalsByDisplay({});
    expect(counts.all).toBeGreaterThanOrEqual(0);
    expect(counts.incomplete).toBeGreaterThanOrEqual(0);
  });
});

describe("logs pagination", () => {
  beforeEach(() => {
    process.env.OPENX_DB_PATH = ":memory:";
  });

  it("returns paginated logs", () => {
    const page = listLogsPage({ limit: 20, offset: 0 });
    expect(Array.isArray(page.logs)).toBe(true);
    expect(page.total).toBeGreaterThanOrEqual(0);
    expect(page.limit).toBe(20);
  });
});
