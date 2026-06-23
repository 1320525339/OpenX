import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetDb } from "./db.js";
import { seedTestProjectAndConversation } from "./test-helpers.js";
import {
  resolveKnowledgeDistillIntervalMs,
  runKnowledgeDistillOnce,
} from "./knowledge-distill-watchdog.js";

describe("knowledge-distill-watchdog", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "openx-distill-watchdog-"));
    writeFileSync(join(tempDir, "config.json"), "{}");
    process.env.OPENX_CONFIG_PATH = join(tempDir, "config.json");
    process.env.OPENX_DB_PATH = ":memory:";
    delete process.env.OPENX_KNOWLEDGE_DISTILL_INTERVAL_MS;
    resetDb();
    seedTestProjectAndConversation();
  });

  afterEach(() => {
    resetDb();
    delete process.env.OPENX_DB_PATH;
    delete process.env.OPENX_CONFIG_PATH;
    delete process.env.OPENX_KNOWLEDGE_DISTILL_INTERVAL_MS;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("uses default interval when env invalid", () => {
    process.env.OPENX_KNOWLEDGE_DISTILL_INTERVAL_MS = "abc";
    expect(resolveKnowledgeDistillIntervalMs()).toBe(30 * 60 * 1000);
  });

  it("runs distill for all user projects", () => {
    const summary = runKnowledgeDistillOnce();
    expect(summary.projectCount).toBeGreaterThanOrEqual(1);
    expect(summary.ranAt).toBeTruthy();
    expect(summary.errors).toBe(0);
  });
});
