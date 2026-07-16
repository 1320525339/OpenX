import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("miloco-habit-suggest-service", () => {
  let tmpDir: string;
  let storePath: string;
  let prevPath: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "openx-habit-"));
    mkdirSync(join(tmpDir, ".openx"), { recursive: true });
    storePath = join(tmpDir, ".openx", "miloco-habit-suggest.json");
    prevPath = process.env.OPENX_MILOCO_HABIT_SUGGEST_PATH;
    process.env.OPENX_MILOCO_HABIT_SUGGEST_PATH = storePath;
  });

  afterEach(() => {
    if (prevPath === undefined) delete process.env.OPENX_MILOCO_HABIT_SUGGEST_PATH;
    else process.env.OPENX_MILOCO_HABIT_SUGGEST_PATH = prevPath;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("record → mark_asked → resolve rejected with permanent dedup", async () => {
    const { applyHabitAction } = await import("./miloco-habit-suggest-service.js");
    const now = "2026-06-27T10:00:00+08:00";

    const rec = await applyHabitAction(
      {
        action: "record",
        key: "evening_gym",
        subject: "shared",
        habit: "傍晚健身",
        suggestion: "健身时放歌单",
      },
      now,
    );
    expect(rec.ok).toBe(true);

    const mark = await applyHabitAction({ action: "mark_asked", key: "evening_gym" }, now);
    expect(mark.ok).toBe(true);

    const rej = await applyHabitAction(
      { action: "resolve", key: "evening_gym", outcome: "rejected" },
      now,
    );
    expect(rej.ok).toBe(true);

    const rec2 = await applyHabitAction(
      {
        action: "record",
        key: "evening_gym",
        subject: "shared",
        habit: "傍晚健身",
        suggestion: "健身时放歌单",
      },
      now,
    );
    expect(rec2.deduped).toBe(true);
    expect(rec2.status).toBe("rejected");
  });

  it("blocks second mark_asked same day", async () => {
    const { applyHabitAction } = await import("./miloco-habit-suggest-service.js");
    const now = "2026-06-27T10:00:00+08:00";

    await applyHabitAction(
      {
        action: "record",
        key: "a",
        habit: "h1",
        suggestion: "s1",
      },
      now,
    );
    await applyHabitAction({ action: "mark_asked", key: "a" }, now);

    await applyHabitAction(
      {
        action: "record",
        key: "b",
        habit: "h2",
        suggestion: "s2",
      },
      now,
    );
    const mark2 = await applyHabitAction({ action: "mark_asked", key: "b" }, now);
    expect(mark2.ok).toBe(false);
  });
});
