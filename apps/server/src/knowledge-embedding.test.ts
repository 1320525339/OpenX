import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  embedKnowledgeText,
  getStoredEmbeddingDimension,
  probeKnowledgeEmbedding,
  resetKnowledgeEmbeddingForTests,
} from "./knowledge-embedding.js";

function useIsolatedOpenxDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "openx-embed-test-"));
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({
      model: { coach: "zen/big-pickle", pi: "zen/big-pickle", default: "zen/big-pickle" },
      providers: {
        zen: {
          name: "OpenCode Zen",
          api: { type: "openai-compatible", baseUrl: "https://opencode.ai/zen/v1" },
          auth: { apiKey: "public" },
          models: { "big-pickle": { name: "big-pickle" } },
          source: { template: "opencode-zen" },
        },
      },
    }),
  );
  process.env.OPENX_CONFIG_PATH = join(dir, "config.json");
  return dir;
}

describe("knowledge-embedding", () => {
  let tempDir = "";
  const fetchMock = vi.fn();

  beforeEach(() => {
    tempDir = useIsolatedOpenxDir();
    delete process.env.OPENX_KNOWLEDGE_SEARCH_MODE;
    resetKnowledgeEmbeddingForTests();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    resetKnowledgeEmbeddingForTests();
    vi.unstubAllGlobals();
    delete process.env.OPENX_CONFIG_PATH;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("probes and caches embedding dimension from coach model", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }] }),
    });

    const ok = await probeKnowledgeEmbedding();
    expect(ok).toBe(true);
    expect(getStoredEmbeddingDimension()).toBe(4);
  });

  it("returns null when embedding API fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    const vector = await embedKnowledgeText("测试知识");
    expect(vector).toBeNull();
  });

  it("reuses in-memory cache for identical text", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [1, 0, 0, 0] }] }),
    });
    await probeKnowledgeEmbedding();
    const callsAfterProbe = fetchMock.mock.calls.length;
    const first = await embedKnowledgeText("缓存测试");
    const callsAfterFirst = fetchMock.mock.calls.length;
    const second = await embedKnowledgeText("缓存测试");
    expect(first).toEqual([1, 0, 0, 0]);
    expect(second).toEqual([1, 0, 0, 0]);
    expect(callsAfterFirst).toBeGreaterThan(callsAfterProbe);
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });
});
