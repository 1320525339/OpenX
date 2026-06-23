import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetKnowledgeEmbeddingForTests } from "./knowledge-embedding.js";
import {
  clearZvecKnowledgeScope,
  buildFtsMatchClause,
  flushPendingDirtyReindex,
  getPendingDirtyScopeKeys,
  getZvecKnowledgeContentForTests,
  isZvecKnowledgeEnabled,
  optimizeZvecKnowledgeScope,
  registerZvecReindexHandler,
  resetZvecKnowledgeIndexForTests,
  runtimeSectionDocId,
  searchZvecKnowledge,
  upsertZvecKnowledgeChunk,
  upsertZvecKnowledgeChunkAsync,
} from "./zvec-knowledge-index.js";

function useIsolatedOpenxDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "openx-zvec-test-"));
  writeFileSync(join(dir, "config.json"), "{}");
  process.env.OPENX_CONFIG_PATH = join(dir, "config.json");
  return dir;
}

function writeEmbeddingSettings(dir: string): void {
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({
      model: { coach: "test/embed-small", pi: "test/embed-small", default: "test/embed-small" },
      providers: {
        test: {
          name: "Test Provider",
          api: { type: "openai-compatible", baseUrl: "https://example.test/v1" },
          auth: { apiKey: "test-key" },
          models: { "embed-small": { name: "embed-small" } },
        },
      },
    }),
  );
}

describe("zvec-knowledge-index", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = useIsolatedOpenxDir();
    delete process.env.OPENX_ZVEC_ENABLED;
    resetZvecKnowledgeIndexForTests();
  });

  afterEach(() => {
    resetZvecKnowledgeIndexForTests();
    resetKnowledgeEmbeddingForTests();
    registerZvecReindexHandler(() => undefined);
    vi.unstubAllGlobals();
    delete process.env.OPENX_ZVEC_ENABLED;
    delete process.env.OPENX_CONFIG_PATH;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("indexes and searches user knowledge with jieba FTS", () => {
    upsertZvecKnowledgeChunk({
      scope: "user",
      projectId: "proj-1",
      docId: "e1",
      content: "# React 约定\n组件使用函数式写法",
    });
    upsertZvecKnowledgeChunk({
      scope: "user",
      projectId: "proj-1",
      docId: "e2",
      content: "# 端口约定\n后端 3921，前端 5173",
    });
    optimizeZvecKnowledgeScope("user", "proj-1");

    const enHits = searchZvecKnowledge("user", "React", {
      projectId: "proj-1",
      limit: 3,
    });
    const zhHits = searchZvecKnowledge("user", "端口", {
      projectId: "proj-1",
      limit: 3,
    });

    expect(enHits).not.toBeNull();
    expect(zhHits).not.toBeNull();
    expect(enHits?.[0]?.content).toContain("React");
    expect(zhHits?.[0]?.content).toContain("3921");
  });

  it("clears scope documents before rebuild", () => {
    upsertZvecKnowledgeChunk({
      scope: "global",
      docId: "old",
      content: "旧的全局知识",
    });
    optimizeZvecKnowledgeScope("global");
    clearZvecKnowledgeScope("global");
    upsertZvecKnowledgeChunk({
      scope: "global",
      docId: "new",
      content: "新的全局 SOP",
    });
    optimizeZvecKnowledgeScope("global");
    const hits = searchZvecKnowledge("global", "SOP", { limit: 3 });
    expect(hits?.some((hit) => hit.content.includes("新的全局"))).toBe(true);
    expect(hits?.some((hit) => hit.content.includes("旧的全局"))).toBe(false);
  });

  it("does not let delayed embedding overwrite newer content", async () => {
    writeEmbeddingSettings(tempDir);
    let resolveOldEmbed: (() => void) | undefined;
    const oldEmbedPromise = new Promise<Response>((resolve) => {
      resolveOldEmbed = () =>
        resolve({
          ok: true,
          json: async () => ({ data: [{ embedding: [0.4, 0.3, 0.2, 0.1] }] }),
        } as Response);
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }] }),
      })
      .mockReturnValueOnce(oldEmbedPromise);
    vi.stubGlobal("fetch", fetchMock);

    await upsertZvecKnowledgeChunkAsync({
      scope: "user",
      projectId: "proj-1",
      docId: "seed",
      content: "seed content",
      acceptModelChange: true,
    });
    clearZvecKnowledgeScope("user", "proj-1");

    upsertZvecKnowledgeChunk({
      scope: "user",
      projectId: "proj-1",
      docId: "same-doc",
      content: "old unique delayed content",
    });
    for (let i = 0; i < 10 && fetchMock.mock.calls.length < 3; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(fetchMock.mock.calls.length).toBe(3);

    upsertZvecKnowledgeChunk({
      scope: "user",
      projectId: "proj-1",
      docId: "same-doc",
      content: "new unique current content",
      embed: false,
    });
    resolveOldEmbed?.();
    await oldEmbedPromise;
    optimizeZvecKnowledgeScope("user", "proj-1");

    let content: string | undefined;
    for (let i = 0; i < 20; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      content = getZvecKnowledgeContentForTests("user", "same-doc", "proj-1");
      if (content) break;
    }
    expect(content).toContain("new unique");
    expect(content).not.toContain("old unique");
  });

  it("returns null when disabled so caller can fallback to SQLite", () => {
    process.env.OPENX_ZVEC_ENABLED = "0";
    resetZvecKnowledgeIndexForTests();
    expect(isZvecKnowledgeEnabled()).toBe(false);
    expect(
      searchZvecKnowledge("global", "测试", { limit: 2 }),
    ).toBeNull();
  });

  it("uses ascii doc ids for runtime sections", () => {
    const id = runtimeSectionDocId("项目概况");
    expect(id).toMatch(/^runtime_[a-f0-9]{16}$/);
  });

  it("buildFtsMatchClause uses matchString for natural language queries", () => {
    expect(buildFtsMatchClause("React 组件约定")).toEqual({ matchString: "React 组件约定" });
    expect(buildFtsMatchClause("端口 + (特殊)")).toEqual({ matchString: "端口 + (特殊)" });
    expect(buildFtsMatchClause("   ")).toBeNull();
  });

  it("searches Chinese sentences and special-character queries via matchString", () => {
    upsertZvecKnowledgeChunk({
      scope: "user",
      projectId: "proj-1",
      docId: "zh",
      content: "# 中文检索\n后端服务监听端口 3921",
    });
    upsertZvecKnowledgeChunk({
      scope: "user",
      projectId: "proj-1",
      docId: "special",
      content: "# 特殊字符\nC++ 模板与 (括号) 查询",
    });
    optimizeZvecKnowledgeScope("user", "proj-1");

    const zhHits = searchZvecKnowledge("user", "后端服务监听端口", {
      projectId: "proj-1",
      limit: 3,
    });
    const specialHits = searchZvecKnowledge("user", "C++ (括号)", {
      projectId: "proj-1",
      limit: 3,
    });

    expect(zhHits?.[0]?.content).toContain("3921");
    expect(specialHits?.[0]?.content).toContain("C++");
  });

  it("defers reindex handler until flushPendingDirtyReindex", async () => {
    writeEmbeddingSettings(tempDir);
    let handlerCalls = 0;
    registerZvecReindexHandler(() => {
      handlerCalls += 1;
    });

    upsertZvecKnowledgeChunk({
      scope: "global",
      docId: "fts-only",
      content: "fts only seed",
      embed: false,
    });
    expect(handlerCalls).toBe(0);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }] }),
      }),
    );
    await upsertZvecKnowledgeChunkAsync({
      scope: "global",
      docId: "vector",
      content: "vector recreate trigger",
      acceptModelChange: true,
    });

    expect(getPendingDirtyScopeKeys()).toContain("global");
    expect(handlerCalls).toBe(0);

    flushPendingDirtyReindex();
    expect(handlerCalls).toBe(1);
    expect(getPendingDirtyScopeKeys()).toHaveLength(0);
  });
});
