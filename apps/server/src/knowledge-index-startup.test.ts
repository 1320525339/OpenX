import { afterEach, describe, expect, it, vi } from "vitest";

describe("knowledge-index-startup", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock("./knowledge-store.js");
    vi.doUnmock("./knowledge-embedding.js");
    delete process.env.OPENX_KNOWLEDGE_STARTUP_REBUILD;
  });

  it("catches startup health check failures", async () => {
    vi.useFakeTimers();
    vi.doMock("./knowledge-store.js", () => ({
      getKnowledgeIndexHealth: () => {
        throw new Error("boom");
      },
      rebuildKnowledgeIndexesAsync: vi.fn(),
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { startKnowledgeIndexStartupCheck } = await import("./knowledge-index-startup.js");

    startKnowledgeIndexStartupCheck();
    await vi.runAllTimersAsync();

    expect(warn).toHaveBeenCalledWith("[knowledge] 启动索引检查失败：", "boom");
  });

  it("rebuilds with embeddings when embedding model changed", async () => {
    const rebuild = vi.fn().mockResolvedValue({
      projects: 1,
      globalEntries: 0,
      userEntries: 0,
      runtimeSections: 0,
    });
    vi.doMock("./knowledge-store.js", () => ({
      getKnowledgeIndexHealth: () => ({
        zvecEnabled: true,
        vectorSearchEnabled: true,
        embeddingAvailable: false,
        needsRebuild: true,
        needsRebuildReasons: ["embedding_model_changed"],
        projects: 1,
        globalEntries: 0,
        userEntries: 0,
        runtimeSections: 0,
        searchMode: "hybrid",
      }),
      rebuildKnowledgeIndexesAsync: rebuild,
    }));
    vi.doMock("./knowledge-embedding.js", () => ({
      probeKnowledgeEmbedding: vi.fn().mockResolvedValue(true),
    }));
    process.env.OPENX_KNOWLEDGE_STARTUP_REBUILD = "1";
    const { runKnowledgeIndexStartupCheck } = await import("./knowledge-index-startup.js");

    await runKnowledgeIndexStartupCheck();

    expect(rebuild).toHaveBeenCalledWith({ includeEmbeddings: true });
    delete process.env.OPENX_KNOWLEDGE_STARTUP_REBUILD;
    vi.doUnmock("./knowledge-store.js");
    vi.doUnmock("./knowledge-embedding.js");
    vi.resetModules();
  });
});
