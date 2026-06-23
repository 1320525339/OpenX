import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetDb, insertConversation, insertProject } from "./db.js";
import { TEST_CONVERSATION_ID, TEST_PROJECT_ID } from "./test-helpers.js";
import { listKnowledgeEntries } from "./knowledge-store.js";
import {
  createKnowledgeSource,
  deleteKnowledgeSource,
  KnowledgeImportGuardError,
  listKnowledgeSources,
  reindexKnowledgeSource,
  updateKnowledgeSourceMeta,
} from "./knowledge-sources.js";
import { resetZvecKnowledgeIndexForTests, shutdownZvecKnowledgeIndex } from "./zvec-knowledge-index.js";

vi.mock("./knowledge-source-distill.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./knowledge-source-distill.js")>();
  return {
    ...actual,
    distillKnowledgeSourceContent: async (
      opts: Parameters<typeof actual.distillKnowledgeSourceContent>[0],
    ) => ({
      title: actual.deriveDefaultKnowledgeSourceLabel(opts.uri, opts.kind),
      summary: opts.rawText.slice(0, 6000),
    }),
  };
});

function useIsolatedOpenxDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "openx-knowledge-sources-"));
  writeFileSync(join(dir, "config.json"), "{}");
  process.env.OPENX_CONFIG_PATH = join(dir, "config.json");
  process.env.OPENX_DB_PATH = ":memory:";
  return dir;
}

describe("knowledge-sources", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = useIsolatedOpenxDir();
    resetDb();
    resetZvecKnowledgeIndexForTests();
    const now = new Date().toISOString();
    insertProject({
      id: TEST_PROJECT_ID,
      name: "Test Project",
      workspaceDir: tempDir,
      createdAt: now,
    });
    insertConversation({
      id: TEST_CONVERSATION_ID,
      projectId: TEST_PROJECT_ID,
      title: "Test Conversation",
      createdAt: now,
      updatedAt: now,
    });
  });

  afterEach(() => {
    resetDb();
    shutdownZvecKnowledgeIndex();
    resetZvecKnowledgeIndexForTests();
    vi.unstubAllGlobals();
    delete process.env.OPENX_DB_PATH;
    delete process.env.OPENX_CONFIG_PATH;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("imports local path documents into user knowledge entries", async () => {
    const docsDir = join(tempDir, "docs");
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(join(docsDir, "guide.md"), "# React 指南\n使用函数组件。");

    const source = await createKnowledgeSource(
      "user",
      { kind: "path", uri: docsDir },
      TEST_PROJECT_ID,
    );

    expect(source.status).toBe("ready");
    expect(source.docCount).toBe(1);
    expect(source.label).toBe("docs");
    const entries = listKnowledgeEntries("user", TEST_PROJECT_ID).filter(
      (e) => e.sourceRefId === source.id,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.content).toContain("函数组件");
  });

  it("imports url list via fetch mock", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => "text/html" },
        text: async () => "<html><body><h1>教程</h1><p>端口 3921</p></body></html>",
      }),
    );

    const source = await createKnowledgeSource(
      "global",
      { uri: "https://example.test/tutorial" },
    );

    expect(source.kind).toBe("url");
    expect(source.docCount).toBe(1);
    const entries = listKnowledgeEntries("global").filter((e) => e.sourceRefId === source.id);
    expect(entries[0]?.content).toContain("3921");
  });

  it("reindexes and deletes source with entries", async () => {
    const docsDir = join(tempDir, "docs2");
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(join(docsDir, "a.md"), "第一版");

    const source = await createKnowledgeSource(
      "user",
      { kind: "path", label: "版本文档", uri: docsDir },
      TEST_PROJECT_ID,
    );
    writeFileSync(join(docsDir, "b.md"), "第二版");
    const reindexed = await reindexKnowledgeSource("user", source.id, TEST_PROJECT_ID);
    expect(reindexed?.docCount).toBe(1);
    const entries = listKnowledgeEntries("user", TEST_PROJECT_ID).filter(
      (e) => e.sourceRefId === source.id,
    );
    expect(entries[0]?.content).toContain("第二版");

    expect(deleteKnowledgeSource("user", source.id, TEST_PROJECT_ID)).toBe(true);
    expect(listKnowledgeSources("user", TEST_PROJECT_ID)).toHaveLength(0);
    expect(
      listKnowledgeEntries("user", TEST_PROJECT_ID).filter((e) => e.sourceRefId === source.id),
    ).toHaveLength(0);
  });

  it("rejects localhost URL imports", async () => {
    await expect(
      createKnowledgeSource("global", { uri: "http://127.0.0.1/secret" }),
    ).rejects.toThrow(KnowledgeImportGuardError);
  });

  it("rejects project paths outside workspace", async () => {
    const outsideDir = mkdtempSync(join(tmpdir(), "openx-outside-ws-"));
    await expect(
      createKnowledgeSource("user", { kind: "path", uri: outsideDir }, TEST_PROJECT_ID),
    ).rejects.toThrow(/工作区/);
    rmSync(outsideDir, { recursive: true, force: true });
  });

  it("reindexes when uri changes on patch", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => "text/plain" },
          text: async () => "第一版内容",
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => "text/plain" },
          text: async () => "第二版内容",
        }),
    );

    const source = await createKnowledgeSource("global", {
      uri: "https://example.test/page-a",
    });
    const first = listKnowledgeEntries("global").find((e) => e.sourceRefId === source.id);
    expect(first?.content).toContain("第一版");

    const updated = await updateKnowledgeSourceMeta("global", source.id, {
      uri: "https://example.test/page-b",
    });
    expect(updated?.status).toBe("ready");
    const second = listKnowledgeEntries("global").find((e) => e.sourceRefId === source.id);
    expect(second?.content).toContain("第二版");
    expect(second?.content).not.toContain("第一版");
  });
});
