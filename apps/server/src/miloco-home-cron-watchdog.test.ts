import { describe, expect, it } from "vitest";
import { cronExprMatches } from "./miloco-home-cron-watchdog.js";

describe("miloco-home-cron-watchdog", () => {
  it("matches */15 at minute 0 and 15", () => {
    const d0 = new Date("2026-06-27T00:00:00+08:00");
    const d15 = new Date("2026-06-27T00:15:00+08:00");
    const d7 = new Date("2026-06-27T00:07:00+08:00");
    expect(cronExprMatches("*/15 * * * *", d0)).toBe(true);
    expect(cronExprMatches("*/15 * * * *", d15)).toBe(true);
    expect(cronExprMatches("*/15 * * * *", d7)).toBe(false);
  });

  it("matches daily 10:00", () => {
    const d = new Date("2026-06-27T10:00:00+08:00");
    const d2 = new Date("2026-06-27T10:01:00+08:00");
    expect(cronExprMatches("0 10 * * *", d)).toBe(true);
    expect(cronExprMatches("0 10 * * *", d2)).toBe(false);
  });
});
