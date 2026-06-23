import { getKnowledgeIndexHealth, rebuildKnowledgeIndexesAsync } from "./knowledge-store.js";
import { probeKnowledgeEmbedding } from "./knowledge-embedding.js";

let started = false;

export function startKnowledgeIndexStartupCheck(): void {
  if (started) return;
  started = true;
  setTimeout(() => {
    void runKnowledgeIndexStartupCheck().catch((err) => {
      console.warn(
        "[knowledge] 启动索引检查失败：",
        err instanceof Error ? err.message : String(err),
      );
    });
  }, 0);
}

export async function runKnowledgeIndexStartupCheck(): Promise<void> {
  const health = getKnowledgeIndexHealth();
  if (!health.zvecEnabled) {
    console.log("[knowledge] Zvec 已禁用，知识库使用 SQLite FTS fallback。");
    return;
  }

  console.log(
    `[knowledge] 索引检查：projects=${health.projects} global=${health.globalEntries} user=${health.userEntries} runtime=${health.runtimeSections} mode=${health.searchMode}`,
  );

  if (health.vectorSearchEnabled) {
    await probeKnowledgeEmbedding();
    const refreshed = getKnowledgeIndexHealth();
    if (!refreshed.embeddingAvailable) {
      console.log("[knowledge] 当前 Coach 模型 embedding 不可用，混合/向量检索将自动退回 FTS。");
    }
  }

  if (health.needsRebuild && process.env.OPENX_KNOWLEDGE_STARTUP_REBUILD === "1") {
    const includeEmbeddings = health.needsRebuildReasons.includes("embedding_model_changed");
    const summary = await rebuildKnowledgeIndexesAsync({ includeEmbeddings });
    console.log(
      `[knowledge] 启动重建完成：embed=${includeEmbeddings} projects=${summary.projects} global=${summary.globalEntries} user=${summary.userEntries} runtime=${summary.runtimeSections}`,
    );
  } else if (health.needsRebuild) {
    const embedHint = health.needsRebuildReasons.includes("embedding_model_changed")
      ? "（含 embedding 模型变更，请使用 POST /api/knowledge/rebuild?embed=1）"
      : "";
    console.log(`[knowledge] 检测到索引可能需要重建，可调用 POST /api/knowledge/rebuild。${embedHint}`);
  }
}
