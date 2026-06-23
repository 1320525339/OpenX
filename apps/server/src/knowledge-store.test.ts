import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetDb } from "./db.js";
import { seedTestProjectAndConversation, TEST_PROJECT_ID } from "./test-helpers.js";
import { resetZvecKnowledgeIndexForTests, shutdownZvecKnowledgeIndex } from "./zvec-knowledge-index.js";
import { resetKnowledgeEmbeddingForTests } from "./knowledge-embedding.js";
import {
  createKnowledgeEntry,
  deleteUserKnowledgeProject,
  ensureRuntimeMemoryInitialized,
  getKnowledgeIndexHealth,
  listKnowledgeEntries,
  loadKnowledgeContextForCoach,
  loadKnowledgeContextForExecutor,
  promoteRuntimeSectionToUser,
  promoteUserEntryToGlobal,
  rebuildKnowledgeIndexesAsync,
  mergeKnowledgeSearchHits,
  searchScopedKnowledge,
} from "./knowledge-store.js";

function useIsolatedOpenxDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "openx-knowledge-test-"));
  writeFileSync(join(dir, "config.json"), "{}");
  process.env.OPENX_CONFIG_PATH = join(dir, "config.json");
  process.env.OPENX_DB_PATH = ":memory:";
  return dir;
}

function writeEmbeddingSettings(dir: string, modelId = "embed-small"): void {
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({
      model: { coach: `test/${modelId}`, pi: `test/${modelId}`, default: `test/${modelId}` },
      providers: {
        test: {
          name: "Test Provider",
          api: { type: "openai-compatible", baseUrl: "https://example.test/v1" },
          auth: { apiKey: "test-key" },
          models: { [modelId]: { name: modelId } },
        },
      },
    }),
  );
}

describe("knowledge-store", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = useIsolatedOpenxDir();
    resetDb();
    resetZvecKnowledgeIndexForTests();
    seedTestProjectAndConversation();
  });

  afterEach(() => {
    resetDb();
    shutdownZvecKnowledgeIndex();
    resetZvecKnowledgeIndexForTests();
    resetKnowledgeEmbeddingForTests();
    vi.unstubAllGlobals();
    delete process.env.OPENX_DB_PATH;
    delete process.env.OPENX_CONFIG_PATH;
    delete process.env.OPENX_KNOWLEDGE_SEARCH_MODE;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates user and global entries under ~/.openx/knowledge", () => {
    const user = createKnowledgeEntry(
      "user",
      { title: "端口约定", content: "后端 3921，前端 5173" },
      TEST_PROJECT_ID,
    );
    const global = createKnowledgeEntry("global", {
      title: "全局 SOP",
      content: "Connect 断连先查 heartbeat",
    });
    expect(listKnowledgeEntries("user", TEST_PROJECT_ID)).toHaveLength(1);
    expect(listKnowledgeEntries("global")).toHaveLength(1);
    expect(user.scope).toBe("user");
    expect(global.scope).toBe("global");
  });

  it("initializes runtime memory in workspace", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "openx-runtime-ws-"));
    const memory = ensureRuntimeMemoryInitialized(workspaceRoot, TEST_PROJECT_ID);
    expect(memory).toContain("## 项目概况");
    expect(memory).toContain("## 蒸馏经验");
    const gitignore = readFileSync(join(workspaceRoot, ".gitignore"), "utf8");
    expect(gitignore).toContain(".openx/");
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("searches user knowledge via FTS", () => {
    createKnowledgeEntry(
      "user",
      { title: "React 约定", content: "组件使用函数式写法" },
      TEST_PROJECT_ID,
    );
    const hits = searchScopedKnowledge("user", "React", {
      projectId: TEST_PROJECT_ID,
      limit: 3,
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.content).toContain("React");
  });

  it("does not call embedding API for rebuild unless requested", async () => {
    writeEmbeddingSettings(tempDir);
    process.env.OPENX_KNOWLEDGE_SEARCH_MODE = "fts";
    createKnowledgeEntry(
      "user",
      { title: "默认重建", content: "不应调用 embedding" },
      TEST_PROJECT_ID,
    );
    delete process.env.OPENX_KNOWLEDGE_SEARCH_MODE;
    resetKnowledgeEmbeddingForTests();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const summary = await rebuildKnowledgeIndexesAsync({
      projectIds: [TEST_PROJECT_ID],
      includeEmbeddings: false,
    });

    expect(summary.embeddingAttempted).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("embeds during rebuild when requested", async () => {
    writeEmbeddingSettings(tempDir);
    process.env.OPENX_KNOWLEDGE_SEARCH_MODE = "fts";
    createKnowledgeEntry(
      "user",
      { title: "向量重建", content: "应该调用 embedding" },
      TEST_PROJECT_ID,
    );
    delete process.env.OPENX_KNOWLEDGE_SEARCH_MODE;
    resetKnowledgeEmbeddingForTests();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const summary = await rebuildKnowledgeIndexesAsync({
      projectIds: [TEST_PROJECT_ID],
      includeEmbeddings: true,
    });

    expect(summary.embeddingAttempted).toBe(true);
    expect(summary.embeddingAvailable).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("marks health as needing rebuild when embedding model changes", async () => {
    writeEmbeddingSettings(tempDir, "embed-small");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }] }),
      }),
    );
    await rebuildKnowledgeIndexesAsync({
      projectIds: [TEST_PROJECT_ID],
      includeEmbeddings: true,
    });
    resetKnowledgeEmbeddingForTests();
    vi.unstubAllGlobals();

    writeEmbeddingSettings(tempDir, "embed-large");
    const health = getKnowledgeIndexHealth();
    expect(health.needsRebuild).toBe(true);
    expect(health.needsRebuildReasons).toContain("embedding_model_changed");
    expect(health.embeddingModelRef).toBe("test/embed-small");
    expect(health.currentEmbeddingModelRef).toBe("test/embed-large");
  });

  it("loads merged coach context for project conversation", () => {
    createKnowledgeEntry(
      "user",
      { title: "验收口径", content: "必须附带测试输出" },
      TEST_PROJECT_ID,
    );
    createKnowledgeEntry("global", {
      title: "调度策略",
      content: "优先 Pi 内嵌执行器",
    });
    const workspaceRoot = process.cwd();
    ensureRuntimeMemoryInitialized(workspaceRoot, TEST_PROJECT_ID);
    const ctx = loadKnowledgeContextForCoach({
      isSystemMain: false,
      projectId: TEST_PROJECT_ID,
      workspaceRoot,
    });
    expect(ctx).toContain("项目用户知识");
    expect(ctx).toContain("项目运行知识");
  });

  it("loads executor context without global knowledge", () => {
    createKnowledgeEntry("global", {
      title: "不应注入执行器",
      content: "调度台 SOP",
    });
    createKnowledgeEntry(
      "user",
      { title: "执行约束", content: "不要改 vendors" },
      TEST_PROJECT_ID,
    );
    const workspaceRoot = process.cwd();
    const ctx = loadKnowledgeContextForExecutor(workspaceRoot, TEST_PROJECT_ID);
    expect(ctx).toContain("执行约束");
    expect(ctx).not.toContain("不应注入执行器");
  });

  it("deletes user knowledge project directory and index", () => {
    createKnowledgeEntry(
      "user",
      { title: "待删除", content: "临时知识" },
      TEST_PROJECT_ID,
    );
    expect(listKnowledgeEntries("user", TEST_PROJECT_ID)).toHaveLength(1);
    expect(deleteUserKnowledgeProject(TEST_PROJECT_ID)).toBe(true);
    expect(listKnowledgeEntries("user", TEST_PROJECT_ID)).toHaveLength(0);
  });

  it("promotes user entry to global and runtime section to user", () => {
    const user = createKnowledgeEntry(
      "user",
      { title: "可复用经验", content: "pnpm test 必须通过" },
      TEST_PROJECT_ID,
    );
    const global = promoteUserEntryToGlobal(TEST_PROJECT_ID, user.id);
    expect(global?.scope).toBe("global");
    expect(listKnowledgeEntries("global").some((e) => e.id === global?.id)).toBe(true);

    const workspaceRoot = process.cwd();
    ensureRuntimeMemoryInitialized(workspaceRoot, TEST_PROJECT_ID);
    const promoted = promoteRuntimeSectionToUser(
      workspaceRoot,
      TEST_PROJECT_ID,
      "蒸馏经验",
    );
    expect(promoted?.title).toBe("蒸馏经验");
  });

  it("mergeKnowledgeSearchHits sorts globally and deduplicates", () => {
    const merged = mergeKnowledgeSearchHits([
      { projectId: "p1", scope: "user", content: "dup", rank: 2 },
      { projectId: "p1", scope: "runtime", content: "better", rank: 0.5 },
      { projectId: "p1", scope: "user", content: "dup", rank: 1 },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.content).toBe("better");
    expect(merged[1]?.content).toBe("dup");
  });

  it("reports extended health fields", () => {
    const health = getKnowledgeIndexHealth();
    expect(health).toHaveProperty("embeddingStatus");
    expect(health).toHaveProperty("markdownCount");
    expect(health).toHaveProperty("zvecLastErrors");
    expect(health).toHaveProperty("pendingDirtyScopes");
    expect(health.rebuildInProgress).toBe(false);
  });
});
