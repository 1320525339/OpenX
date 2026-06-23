import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  ZVecCollectionSchema,
  ZVecCreateAndOpen,
  ZVecDataType,
  ZVecIndexType,
  ZVecInitialize,
  ZVecLogLevel,
  ZVecMetricType,
  ZVecOpen,
  isZVecError,
  type ZVecCollection,
  type ZVecFtsQuery,
  type ZVecStatus,
} from "@zvec/zvec";
import { GLOBAL_KNOWLEDGE_PROJECT_ID, type KnowledgeScope } from "@openx/shared";
import type { MemorySearchHit } from "./db.js";
import {
  embedKnowledgeText,
  getStoredEmbeddingDimension,
  isKnowledgeEmbeddingAvailable,
  isKnowledgeVectorSearchEnabled,
  probeKnowledgeEmbedding,
  resolveKnowledgeSearchMode,
  truncateKnowledgeEmbedInput,
} from "./knowledge-embedding.js";
import { getZvecRoot } from "./paths.js";

const COLLECTION_DIR_NAME = "collection";
const COLLECTION_NAME = "openx_knowledge";
const CONTENT_FIELD = "content";
const SCOPE_FIELD = "scope";
const CONTENT_HASH_FIELD = "contentHash";
const EMBEDDING_FIELD = "embedding";
const MAX_DOC_HASH_ENTRIES = 2000;
const MAX_ZVEC_ERROR_LOG = 20;

let initState: "pending" | "ready" | "unavailable" = "pending";
const collectionCache = new Map<string, ZVecCollection>();
const latestDocHashes = new Map<string, string>();
const pendingDirtyScopes = new Set<string>();
let dirtyFlushScheduled = false;
let reindexInProgress = false;

export type ZvecErrorRecord = {
  at: string;
  operation: string;
  scope?: KnowledgeScope;
  projectId?: string;
  docId?: string;
  code?: string;
  message: string;
};

const zvecLastErrors: ZvecErrorRecord[] = [];

type ZvecReindexHandler = (scope: KnowledgeScope, projectId?: string) => void;
let reindexHandler: ZvecReindexHandler | undefined;

export function registerZvecReindexHandler(handler: ZvecReindexHandler): void {
  reindexHandler = handler;
}

function scopeDirtyKey(scope: KnowledgeScope, projectId?: string): string {
  return collectionCacheKey(scope, projectId);
}

function markScopeDirty(scope: KnowledgeScope, projectId?: string): void {
  pendingDirtyScopes.add(scopeDirtyKey(scope, projectId));
  scheduleDirtyReindexFlush();
}

function scheduleDirtyReindexFlush(): void {
  if (dirtyFlushScheduled || reindexInProgress) return;
  dirtyFlushScheduled = true;
  setImmediate(() => {
    dirtyFlushScheduled = false;
    flushPendingDirtyReindex();
  });
}

/** 处理 schema 升级后待重建的 scope（非重入） */
export function flushPendingDirtyReindex(): void {
  if (reindexInProgress || !reindexHandler || pendingDirtyScopes.size === 0) return;
  reindexInProgress = true;
  const keys = [...pendingDirtyScopes];
  pendingDirtyScopes.clear();
  try {
    for (const key of keys) {
      if (key === "global") {
        reindexHandler("global");
        continue;
      }
      const projectId = key.startsWith("project:") ? key.slice("project:".length) : undefined;
      if (!projectId) continue;
      reindexHandler("user", projectId);
      reindexHandler("runtime", projectId);
    }
  } finally {
    reindexInProgress = false;
  }
}

export function getPendingDirtyScopeKeys(): string[] {
  return [...pendingDirtyScopes];
}

export function recordZvecError(
  operation: string,
  err: unknown,
  ctx?: { scope?: KnowledgeScope; projectId?: string; docId?: string },
): void {
  const code = isZVecError(err) ? err.code : undefined;
  const message = err instanceof Error ? err.message : String(err);
  zvecLastErrors.unshift({
    at: new Date().toISOString(),
    operation,
    scope: ctx?.scope,
    projectId: ctx?.projectId,
    docId: ctx?.docId,
    code,
    message,
  });
  if (zvecLastErrors.length > MAX_ZVEC_ERROR_LOG) {
    zvecLastErrors.length = MAX_ZVEC_ERROR_LOG;
  }
  if (code === "ZVEC_PERMISSION_DENIED" || message.includes("LOCK")) {
    console.warn(
      `[knowledge] Zvec ${operation} 失败（单写者/文件锁）：${message}`,
    );
  }
}

function assertZvecStatus(
  status: ZVecStatus,
  operation: string,
  ctx?: { scope?: KnowledgeScope; projectId?: string; docId?: string },
): void {
  if (status.ok) return;
  recordZvecError(operation, new Error(status.message), ctx);
}

function setLatestDocHash(key: string, hash: string): void {
  if (latestDocHashes.size >= MAX_DOC_HASH_ENTRIES && !latestDocHashes.has(key)) {
    const oldest = latestDocHashes.keys().next().value;
    if (oldest) latestDocHashes.delete(oldest);
  }
  latestDocHashes.set(key, hash);
}

/** 默认 FTS：matchString 走 jieba 分词，避免 queryString 布尔语法误解析 */
export function buildFtsMatchClause(query: string): ZVecFtsQuery | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  return { matchString: trimmed };
}

export function getZvecLastErrors(): ZvecErrorRecord[] {
  return [...zvecLastErrors];
}

export function getZvecCollectionDocCount(
  scope: KnowledgeScope,
  projectId?: string,
): number | undefined {
  if (!ensureZvecReady()) return undefined;
  try {
    return openCollection(scope, projectId).stats.docCount;
  } catch {
    return undefined;
  }
}

function ftsOnlySchema(): ZVecCollectionSchema {
  return new ZVecCollectionSchema({
    name: COLLECTION_NAME,
    fields: [
      {
        name: SCOPE_FIELD,
        dataType: ZVecDataType.STRING,
        indexParams: { indexType: ZVecIndexType.INVERT },
      },
      {
        name: CONTENT_FIELD,
        dataType: ZVecDataType.STRING,
        indexParams: {
          indexType: ZVecIndexType.FTS,
          tokenizerName: "jieba",
        },
      },
      {
        name: CONTENT_HASH_FIELD,
        dataType: ZVecDataType.STRING,
      },
    ],
  });
}

function hybridSchema(dimension: number): ZVecCollectionSchema {
  return new ZVecCollectionSchema({
    name: COLLECTION_NAME,
    vectors: {
      name: EMBEDDING_FIELD,
      dataType: ZVecDataType.VECTOR_FP32,
      dimension,
      indexParams: {
        indexType: ZVecIndexType.HNSW,
        metricType: ZVecMetricType.COSINE,
      },
    },
    fields: [
      {
        name: SCOPE_FIELD,
        dataType: ZVecDataType.STRING,
        indexParams: { indexType: ZVecIndexType.INVERT },
      },
      {
        name: CONTENT_FIELD,
        dataType: ZVecDataType.STRING,
        indexParams: {
          indexType: ZVecIndexType.FTS,
          tokenizerName: "jieba",
        },
      },
      {
        name: CONTENT_HASH_FIELD,
        dataType: ZVecDataType.STRING,
      },
    ],
  });
}

function collectionHasEmbeddingVector(
  collection: ZVecCollection,
  dimension: number,
): boolean {
  return collection.schema.vectors().some(
    (vector) => vector.name === EMBEDDING_FIELD && vector.dimension === dimension,
  );
}

function collectionHasContentHashField(collection: ZVecCollection): boolean {
  return collection.schema.fields().some((field) => field.name === CONTENT_HASH_FIELD);
}

function resolveHybridRrfK(): number {
  const raw = Number.parseInt(process.env.OPENX_KNOWLEDGE_HYBRID_RRF_K ?? "60", 10);
  if (!Number.isFinite(raw) || raw < 1) return 60;
  return raw;
}

/** 总开关：OPENX_ZVEC_ENABLED=0 时禁用并回退 SQLite FTS */
export function isZvecKnowledgeEnabled(): boolean {
  const raw = process.env.OPENX_ZVEC_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  return true;
}

function ensureZvecReady(): boolean {
  if (!isZvecKnowledgeEnabled()) {
    initState = "unavailable";
    return false;
  }
  if (initState === "ready") return true;
  if (initState === "unavailable") return false;
  try {
    ZVecInitialize({ logLevel: ZVecLogLevel.WARN });
    initState = "ready";
    return true;
  } catch {
    initState = "unavailable";
    return false;
  }
}

function collectionCacheKey(scope: KnowledgeScope, projectId?: string): string {
  if (scope === "global") return "global";
  if (!projectId) throw new Error("projectId required");
  return `project:${projectId}`;
}

function docHashKey(scope: KnowledgeScope, projectId: string | undefined, docId: string): string {
  return `${collectionCacheKey(scope, projectId)}:${docId}`;
}

function collectionPath(scope: KnowledgeScope, projectId?: string): string {
  if (scope === "global") {
    return join(getZvecRoot(), "global", COLLECTION_DIR_NAME);
  }
  if (!projectId) throw new Error("projectId required");
  return join(getZvecRoot(), "projects", projectId, COLLECTION_DIR_NAME);
}

function ftsProjectIdForScope(scope: KnowledgeScope, projectId?: string): string {
  if (scope === "global") return GLOBAL_KNOWLEDGE_PROJECT_ID;
  if (!projectId) throw new Error("projectId required");
  return projectId;
}

function closeCachedCollection(key: string): void {
  const existing = collectionCache.get(key);
  if (!existing) return;
  try {
    existing.closeSync();
  } catch {
    /* ignore */
  }
  collectionCache.delete(key);
}

function recreateCollection(
  scope: KnowledgeScope,
  projectId: string | undefined,
  schema: ZVecCollectionSchema,
): ZVecCollection {
  const key = collectionCacheKey(scope, projectId);
  closeCachedCollection(key);
  const path = collectionPath(scope, projectId);
  if (existsSync(path)) {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      /* Windows LOCK */
    }
  }
  mkdirSync(join(path, ".."), { recursive: true });
  const collection = ZVecCreateAndOpen(path, schema);
  collectionCache.set(key, collection);
  markScopeDirty(scope, projectId);
  return collection;
}

function openCollection(
  scope: KnowledgeScope,
  projectId?: string,
  opts?: { requireVector?: boolean },
): ZVecCollection {
  const key = collectionCacheKey(scope, projectId);
  const cached = collectionCache.get(key);
  const dimension = getStoredEmbeddingDimension();
  const wantVector =
    Boolean(opts?.requireVector) ||
    (isKnowledgeVectorSearchEnabled() && Boolean(dimension));

  if (cached) {
    if (!collectionHasContentHashField(cached)) {
      return recreateCollection(
        scope,
        projectId,
        wantVector && dimension ? hybridSchema(dimension) : ftsOnlySchema(),
      );
    }
    if (!wantVector || !dimension || collectionHasEmbeddingVector(cached, dimension)) {
      return cached;
    }
    return recreateCollection(scope, projectId, hybridSchema(dimension));
  }

  const path = collectionPath(scope, projectId);
  mkdirSync(join(path, ".."), { recursive: true });

  if (existsSync(path)) {
    const existing = ZVecOpen(path);
    if (!collectionHasContentHashField(existing)) {
      try {
        existing.closeSync();
      } catch {
        /* ignore */
      }
      return recreateCollection(
        scope,
        projectId,
        wantVector && dimension ? hybridSchema(dimension) : ftsOnlySchema(),
      );
    }
    if (!wantVector || !dimension) {
      collectionCache.set(key, existing);
      return existing;
    }
    if (collectionHasEmbeddingVector(existing, dimension)) {
      collectionCache.set(key, existing);
      return existing;
    }
    try {
      existing.closeSync();
    } catch {
      /* ignore */
    }
    return recreateCollection(scope, projectId, hybridSchema(dimension));
  }

  const schema =
    wantVector && dimension ? hybridSchema(dimension) : ftsOnlySchema();
  const collection = ZVecCreateAndOpen(path, schema);
  collectionCache.set(key, collection);
  return collection;
}

function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function placeholderVectorsForCollection(
  collection: ZVecCollection,
): Record<string, number[]> | undefined {
  const dimension = getStoredEmbeddingDimension();
  if (!dimension || !collectionHasEmbeddingVector(collection, dimension)) return undefined;
  return { [EMBEDDING_FIELD]: Array.from({ length: dimension }, () => 0) };
}

function mapDocToHit(
  scope: KnowledgeScope,
  projectId: string | undefined,
  doc: { score: number; fields: Record<string, unknown> },
): MemorySearchHit {
  const content = typeof doc.fields[CONTENT_FIELD] === "string"
    ? doc.fields[CONTENT_FIELD]
    : "";
  return {
    projectId: ftsProjectIdForScope(scope, projectId),
    scope,
    content,
    rank: -doc.score,
  };
}

export function runtimeSectionDocId(heading: string): string {
  const hash = createHash("sha256").update(heading.trim(), "utf8").digest("hex").slice(0, 16);
  return `runtime_${hash}`;
}

async function resolveQueryVector(query: string): Promise<number[] | null> {
  if (!isKnowledgeVectorSearchEnabled()) return null;
  if (!isKnowledgeEmbeddingAvailable()) {
    const ok = await probeKnowledgeEmbedding();
    if (!ok) return null;
  }
  return embedKnowledgeText(query);
}

function searchFtsOnly(
  collection: ZVecCollection,
  scope: KnowledgeScope,
  projectId: string | undefined,
  query: string,
  limit: number,
): MemorySearchHit[] {
  const fts = buildFtsMatchClause(query);
  if (!fts) return [];
  try {
    const docs = collection.querySync({
      fieldName: CONTENT_FIELD,
      fts,
      filter: `${SCOPE_FIELD}='${scope}'`,
      topk: limit,
      outputFields: [SCOPE_FIELD, CONTENT_FIELD],
    });
    return docs.map((doc) => mapDocToHit(scope, projectId, doc));
  } catch (err) {
    recordZvecError("searchFtsOnly", err, { scope, projectId });
    throw err;
  }
}

function searchVectorOnly(
  collection: ZVecCollection,
  scope: KnowledgeScope,
  projectId: string | undefined,
  queryVector: number[],
  limit: number,
): MemorySearchHit[] {
  const docs = collection.querySync({
    fieldName: EMBEDDING_FIELD,
    vector: queryVector,
    filter: `${SCOPE_FIELD}='${scope}'`,
    topk: limit,
    outputFields: [SCOPE_FIELD, CONTENT_FIELD],
  });
  return docs.map((doc) => mapDocToHit(scope, projectId, doc));
}

function searchHybrid(
  collection: ZVecCollection,
  scope: KnowledgeScope,
  projectId: string | undefined,
  query: string,
  queryVector: number[],
  limit: number,
): MemorySearchHit[] {
  const fts = buildFtsMatchClause(query);
  if (!fts) return [];
  const candidates = Math.max(limit * 3, 10);
  const docs = collection.multiQuerySync({
    queries: [
      {
        fieldName: CONTENT_FIELD,
        fts,
        numCandidates: candidates,
      },
      {
        fieldName: EMBEDDING_FIELD,
        vector: queryVector,
        numCandidates: candidates,
      },
    ],
    topk: limit,
    filter: `${SCOPE_FIELD}='${scope}'`,
    rerank: { type: "rrf", rankConstant: resolveHybridRrfK() },
    outputFields: [SCOPE_FIELD, CONTENT_FIELD],
  });
  return docs.map((doc) => mapDocToHit(scope, projectId, doc));
}

async function embedAndUpsertVector(opts: {
  scope: KnowledgeScope;
  projectId?: string;
  docId: string;
  content: string;
  contentHash: string;
  acceptModelChange?: boolean;
}): Promise<void> {
  if (!ensureZvecReady() || !isKnowledgeVectorSearchEnabled()) return;
  const key = docHashKey(opts.scope, opts.projectId, opts.docId);
  if (latestDocHashes.get(key) !== opts.contentHash) return;
  const ok = await probeKnowledgeEmbedding({ acceptModelChange: opts.acceptModelChange });
  if (!ok) return;
  if (latestDocHashes.get(key) !== opts.contentHash) return;

  const vector = await embedKnowledgeText(truncateKnowledgeEmbedInput(opts.content), {
    acceptModelChange: opts.acceptModelChange,
  });
  if (!vector) return;
  if (latestDocHashes.get(key) !== opts.contentHash) return;

  try {
    const collection = openCollection(opts.scope, opts.projectId, { requireVector: true });
    if (!collectionHasEmbeddingVector(collection, vector.length)) return;
    const status = collection.updateSync({
      id: opts.docId,
      fields: {
        [SCOPE_FIELD]: opts.scope,
        [CONTENT_FIELD]: opts.content,
        [CONTENT_HASH_FIELD]: opts.contentHash,
      },
      vectors: { [EMBEDDING_FIELD]: vector },
    });
    assertZvecStatus(status, "updateSync", {
      scope: opts.scope,
      projectId: opts.projectId,
      docId: opts.docId,
    });
  } catch (err) {
    recordZvecError("embedAndUpsertVector", err, {
      scope: opts.scope,
      projectId: opts.projectId,
      docId: opts.docId,
    });
  }
}

/** 写入或更新单条知识块（FTS 同步；向量异步） */
export function upsertZvecKnowledgeChunk(opts: {
  scope: KnowledgeScope;
  projectId?: string;
  docId: string;
  content: string;
  embed?: boolean;
}): void {
  if (!ensureZvecReady()) return;
  const hash = contentHash(opts.content);
  setLatestDocHash(docHashKey(opts.scope, opts.projectId, opts.docId), hash);
  try {
    const collection = openCollection(opts.scope, opts.projectId);
    const vectors = placeholderVectorsForCollection(collection);
    const status = collection.upsertSync({
      id: opts.docId,
      fields: {
        [SCOPE_FIELD]: opts.scope,
        [CONTENT_FIELD]: opts.content,
        [CONTENT_HASH_FIELD]: hash,
      },
      ...(vectors ? { vectors } : {}),
    });
    assertZvecStatus(status, "upsertSync", {
      scope: opts.scope,
      projectId: opts.projectId,
      docId: opts.docId,
    });
  } catch (err) {
    recordZvecError("upsertZvecKnowledgeChunk", err, {
      scope: opts.scope,
      projectId: opts.projectId,
      docId: opts.docId,
    });
  }
  if (opts.embed !== false) {
    void embedAndUpsertVector({ ...opts, contentHash: hash });
  }
}

/** 写入并等待向量同步完成，用于全量重建/健康修复。 */
export async function upsertZvecKnowledgeChunkAsync(opts: {
  scope: KnowledgeScope;
  projectId?: string;
  docId: string;
  content: string;
  embed?: boolean;
  acceptModelChange?: boolean;
}): Promise<void> {
  if (!ensureZvecReady()) return;
  const hash = contentHash(opts.content);
  setLatestDocHash(docHashKey(opts.scope, opts.projectId, opts.docId), hash);
  try {
    const collection = openCollection(opts.scope, opts.projectId);
    const vectors = placeholderVectorsForCollection(collection);
    const status = collection.upsertSync({
      id: opts.docId,
      fields: {
        [SCOPE_FIELD]: opts.scope,
        [CONTENT_FIELD]: opts.content,
        [CONTENT_HASH_FIELD]: hash,
      },
      ...(vectors ? { vectors } : {}),
    });
    assertZvecStatus(status, "upsertSync", {
      scope: opts.scope,
      projectId: opts.projectId,
      docId: opts.docId,
    });
  } catch (err) {
    recordZvecError("upsertZvecKnowledgeChunkAsync", err, {
      scope: opts.scope,
      projectId: opts.projectId,
      docId: opts.docId,
    });
  }
  if (opts.embed !== false) {
    await embedAndUpsertVector({ ...opts, contentHash: hash });
  }
}

/** 清空某 scope 下的全部文档（保留 collection） */
export function clearZvecKnowledgeScope(scope: KnowledgeScope, projectId?: string): void {
  if (!ensureZvecReady()) return;
  const prefix = `${collectionCacheKey(scope, projectId)}:`;
  for (const key of [...latestDocHashes.keys()]) {
    if (key.startsWith(prefix)) latestDocHashes.delete(key);
  }
  try {
    const collection = openCollection(scope, projectId);
    collection.deleteByFilterSync(`${SCOPE_FIELD}='${scope}'`);
    collection.optimizeSync();
  } catch {
    /* ignore */
  }
}

/** 删除项目 Zvec 索引目录 */
export function deleteZvecKnowledgeProject(projectId: string): void {
  closeCachedCollection(collectionCacheKey("user", projectId));
  closeCachedCollection(collectionCacheKey("runtime", projectId));
  const dir = join(getZvecRoot(), "projects", projectId);
  if (!existsSync(dir)) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows 上 collection 未关闭时可能 EBUSY */
  }
}

function searchZvecKnowledgeInternal(
  scope: KnowledgeScope,
  query: string,
  opts: { projectId?: string; limit?: number; queryVector?: number[] | null },
): MemorySearchHit[] | null {
  if (!ensureZvecReady()) return null;
  const trimmed = query.trim();
  if (!trimmed) return [];

  try {
    const limit = opts.limit ?? 5;
    const collection = openCollection(scope, opts.projectId);
    const mode = resolveKnowledgeSearchMode();
    const dimension = getStoredEmbeddingDimension();
    const hasVector =
      Boolean(dimension) &&
      collectionHasEmbeddingVector(collection, dimension!);
    const queryVector = opts.queryVector ?? null;

    if (mode === "vector" && hasVector && queryVector) {
      return searchVectorOnly(collection, scope, opts.projectId, queryVector, limit);
    }
    if (mode === "hybrid" && hasVector && queryVector) {
      return searchHybrid(collection, scope, opts.projectId, trimmed, queryVector, limit);
    }
    return searchFtsOnly(collection, scope, opts.projectId, trimmed, limit);
  } catch {
    return null;
  }
}

/**
 * Zvec FTS 检索（同步）；无 query 向量时走 FTS。
 * 返回 null 表示应回退 SQLite FTS。
 */
export function searchZvecKnowledge(
  scope: KnowledgeScope,
  query: string,
  opts?: { projectId?: string; limit?: number },
): MemorySearchHit[] | null {
  return searchZvecKnowledgeInternal(scope, query, opts ?? {});
}

/** 混合/向量检索（异步，需 embedding query） */
export async function searchZvecKnowledgeAsync(
  scope: KnowledgeScope,
  query: string,
  opts?: { projectId?: string; limit?: number },
): Promise<MemorySearchHit[] | null> {
  const queryVector = await resolveQueryVector(query);
  return searchZvecKnowledgeInternal(scope, query, {
    ...opts,
    queryVector,
  });
}

/** 批量写入后优化索引结构 */
export function optimizeZvecKnowledgeScope(
  scope: KnowledgeScope,
  projectId?: string,
): void {
  if (!ensureZvecReady()) return;
  try {
    openCollection(scope, projectId).optimizeSync();
  } catch {
    /* SQLite fallback 仍可用 */
  }
}

/** 测试专用：关闭缓存并重置初始化状态 */
export function getZvecKnowledgeContentForTests(
  scope: KnowledgeScope,
  docId: string,
  projectId?: string,
): string | undefined {
  if (!ensureZvecReady()) return undefined;
  try {
    const doc = openCollection(scope, projectId).fetchSync({
      ids: docId,
      outputFields: [CONTENT_FIELD],
      includeVector: false,
    })[docId];
    return typeof doc?.fields?.[CONTENT_FIELD] === "string"
      ? doc.fields[CONTENT_FIELD]
      : undefined;
  } catch {
    return undefined;
  }
}

export function resetZvecKnowledgeIndexForTests(): void {
  for (const key of [...collectionCache.keys()]) {
    closeCachedCollection(key);
  }
  latestDocHashes.clear();
  pendingDirtyScopes.clear();
  dirtyFlushScheduled = false;
  reindexInProgress = false;
  zvecLastErrors.length = 0;
  initState = "pending";
}

/** 测试 teardown：关闭全部 collection，避免 Windows 上 LOCK 文件占用 */
export function shutdownZvecKnowledgeIndex(): void {
  resetZvecKnowledgeIndexForTests();
}
