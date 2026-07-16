import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDb, getDb, getDbIntegrityStatus, insertGoal, deleteGoals } from "./db.js";
import { pruneRetentionTables } from "./db/retention.js";
import {
  createOpenxBackup,
  getPersistenceHealth,
  factoryResetOpenx,
  listOpenxBackups,
} from "./openx-backup.js";
import { atomicWriteText, SENSITIVE_FILE_MODE } from "./atomic-json.js";
import { upsertOpenxDotEnv, loadOpenxDotEnv } from "./openx-dotenv.js";

describe("local persistence commercial baseline", () => {
  let home: string;
  const prevHome = process.env.OPENX_HOME;
  const prevDb = process.env.OPENX_DB_PATH;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "openx-persist-"));
    process.env.OPENX_HOME = home;
    process.env.OPENX_DB_PATH = join(home, "openx.db");
    delete process.env.OPENX_CONFIG_PATH;
    delete process.env.OPENX_PROVIDERS_PATH;
    delete process.env.OPENX_DOTENV_PATH;
    resetDb();
  });

  afterEach(() => {
    resetDb();
    if (prevHome === undefined) delete process.env.OPENX_HOME;
    else process.env.OPENX_HOME = prevHome;
    if (prevDb === undefined) delete process.env.OPENX_DB_PATH;
    else process.env.OPENX_DB_PATH = prevDb;
    rmSync(home, { recursive: true, force: true });
  });

  it("enables foreign_keys and records schema migrations", () => {
    const db = getDb();
    const fk = db.pragma("foreign_keys", { simple: true });
    expect(fk).toBe(1);
    const integrity = getDbIntegrityStatus();
    expect(integrity.ok).toBe(true);
    const rows = db.prepare("SELECT id, name FROM schema_migrations ORDER BY id").all() as {
      id: number;
      name: string;
    }[];
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(rows[0]?.name).toBe("baseline");
  });

  it("purges goal side tables in deleteGoals", () => {
    const now = new Date().toISOString();
    insertGoal({
      id: "g1",
      conversationId: "conv-persist",
      title: "t",
      acceptance: "a",
      executionPrompt: "p",
      constraints: [],
      executorId: "mock",
      status: "draft",
      progress: 0,
      orderNo: 1,
      dependsOn: [],
      priority: "medium",
      autoReview: false,
      iterationCount: 0,
      waived: false,
      createdAt: now,
      updatedAt: now,
    });
    getDb()
      .prepare(
        `INSERT INTO dispatch_receipts (receipt_id, goal_id, run_id, executor_id, created_at)
         VALUES ('r1', 'g1', 'run1', 'mock', ?)`,
      )
      .run(now);
    getDb()
      .prepare(
        `INSERT INTO token_usage_events (goal_id, recorded_at) VALUES ('g1', ?)`,
      )
      .run(now);
    const result = deleteGoals(["g1"], { force: true });
    expect(result.deleted).toEqual(["g1"]);
    const receipts = getDb()
      .prepare("SELECT COUNT(*) AS c FROM dispatch_receipts WHERE goal_id = 'g1'")
      .get() as { c: number };
    const tokens = getDb()
      .prepare("SELECT COUNT(*) AS c FROM token_usage_events WHERE goal_id = 'g1'")
      .get() as { c: number };
    expect(receipts.c).toBe(0);
    expect(tokens.c).toBe(0);
  });

  it("creates backup and reports health", () => {
    writeFileSync(join(home, "config.json"), "{}\n", "utf8");
    getDb();
    const backup = createOpenxBackup({ label: "test" });
    expect(backup.id).toMatch(/^backup-/);
    expect(listOpenxBackups().length).toBeGreaterThanOrEqual(1);
    const health = getPersistenceHealth();
    expect(health.openxHome).toBe(home);
    expect(health.dbIntegrityOk).toBe(true);
    expect(health.schemaMigrationCount).toBeGreaterThanOrEqual(3);
  });

  it("writes .env atomically", () => {
    upsertOpenxDotEnv({ TEST_OPENX_KEY: "secret-value" });
    const envPath = join(home, ".env");
    expect(existsSync(envPath)).toBe(true);
    expect(readFileSync(envPath, "utf8")).toContain("TEST_OPENX_KEY=secret-value");
    loadOpenxDotEnv(true);
    expect(process.env.TEST_OPENX_KEY).toBe("secret-value");
    delete process.env.TEST_OPENX_KEY;
  });

  it("factory reset clears home but can keep backups", () => {
    writeFileSync(join(home, "config.json"), "{}\n", "utf8");
    getDb();
    createOpenxBackup();
    const result = factoryResetOpenx({ keepBackups: true });
    expect(result.removed).toContain("config.json");
    expect(existsSync(join(home, "backups"))).toBe(true);
  });

  it("pruneRetentionTables runs without error", () => {
    getDb();
    expect(() => pruneRetentionTables()).not.toThrow();
  });

  it("atomicWriteText supports mode option", () => {
    const path = join(home, "token-like.txt");
    atomicWriteText(path, "abc\n", { mode: SENSITIVE_FILE_MODE });
    expect(readFileSync(path, "utf8")).toBe("abc\n");
  });
});
