import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { nanoid } from "nanoid";
import {
  GLOBAL_KNOWLEDGE_PROJECT_ID,
  formatKnowledgeEntryFile,
  formatKnowledgeHitsForPrompt,
  parseKnowledgeEntryFile,
  type CreateKnowledgeEntryInput,
  type KnowledgeContextSelection,
  type KnowledgeEntry,
  type KnowledgeScope,
  type UpdateKnowledgeEntryInput,
} from "@openx/shared";
import {
  clearMemoryIndex,
  getProjectById,
  indexMemoryChunk,
  listProjects,
  searchMemoryFts,
  type MemorySearchHit,
} from "./db.js";
import {
  getStoredEmbeddingDimension,
  getStoredEmbeddingModelRef,
  getCurrentKnowledgeEmbeddingModelRef,
  hasKnowledgeEmbeddingModelChanged,
  isKnowledgeEmbeddingAvailable,
  isKnowledgeVectorSearchEnabled,
  probeKnowledgeEmbedding,
  resolveKnowledgeSearchMode,
} from "./knowledge-embedding.js";
import { getKnowledgeRoot, getZvecRoot } from "./paths.js";
import { ensureWorkspaceOpenxGitignore } from "./workspace-gitignore.js";
import {
  clearZvecKnowledgeScope,
  deleteZvecKnowledgeProject,
  flushPendingDirtyReindex,
  getPendingDirtyScopeKeys,
  getZvecCollectionDocCount,
  getZvecLastErrors,
  isZvecKnowledgeEnabled,
  optimizeZvecKnowledgeScope,
  registerZvecReindexHandler,
  runtimeSectionDocId,
  searchZvecKnowledge,
  searchZvecKnowledgeAsync,
  upsertZvecKnowledgeChunkAsync,
  upsertZvecKnowledgeChunk,
} from "./zvec-knowledge-index.js";
import { resolveWorkspaceRoot } from "./workspace-path.js";

const RUNTIME_MEMORY_ROOT = ".openx/memory";
const RUNTIME_SCOPE = "runtime";
const USER_SCOPE = "user";

export function globalKnowledgeEntriesDir(): string {
  return join(getKnowledgeRoot(), "global", "entries");
}

export function userKnowledgeEntriesDir(projectId: string): string {
  return join(getKnowledgeRoot(), "projects", projectId, "entries");
}

/** 删除项目时清理 ~/.openx 下的用户知识（L2） */
export function deleteUserKnowledgeProject(projectId: string): boolean {
  const dir = userKnowledgeEntriesDir(projectId);
  clearMemoryIndex(projectId, USER_SCOPE);
  deleteZvecKnowledgeProject(projectId);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  const projectDir = join(getKnowledgeRoot(), "projects", projectId);
  if (existsSync(projectDir)) {
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch {
      /* 目录非空时忽略 */
    }
  }
  return true;
}

export function runtimeMemoryFile(workspaceRoot: string, projectId: string): string {
  return join(workspaceRoot, RUNTIME_MEMORY_ROOT, "projects", projectId, "MEMORY.md");
}

function entriesDirForScope(scope: "global" | "user", projectId?: string): string {
  if (scope === "global") return globalKnowledgeEntriesDir();
  if (!projectId) throw new Error("projectId required for user knowledge");
  return userKnowledgeEntriesDir(projectId);
}

function ftsProjectIdForScope(scope: KnowledgeScope, projectId?: string): string {
  if (scope === "global") return GLOBAL_KNOWLEDGE_PROJECT_ID;
  if (!projectId) throw new Error("projectId required");
  return projectId;
}

function listEntryFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith(".md"));
}

function readEntryFromFile(
  filePath: string,
  id: string,
  scope: "global" | "user",
  projectId?: string,
): KnowledgeEntry | null {
  try {
    const raw = readFileSync(filePath, "utf8");
    return parseKnowledgeEntryFile(id, scope, raw, projectId);
  } catch {
    return null;
  }
}

export function listKnowledgeEntries(
  scope: "global" | "user",
  projectId?: string,
): KnowledgeEntry[] {
  const dir = entriesDirForScope(scope, projectId);
  const entries: KnowledgeEntry[] = [];
  for (const file of listEntryFiles(dir)) {
    const id = file.replace(/\.md$/, "");
    const entry = readEntryFromFile(join(dir, file), id, scope, projectId);
    if (entry) entries.push(entry);
  }
  return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function entryChunkText(entry: KnowledgeEntry): string {
  return [
    entry.sourceRefId ? `来源引用：${entry.sourceRefId}` : "",
    entry.sourceUri ? `来源路径：${entry.sourceUri}` : "",
    `# ${entry.title}`,
    `分类：${entry.category}`,
    entry.tags.length > 0 ? `标签：${entry.tags.join(", ")}` : "",
    entry.content,
  ]
    .filter(Boolean)
    .join("\n");
}

function syncEntryToIndex(entry: KnowledgeEntry, opts?: { embed?: boolean }): void {
  const projectId = ftsProjectIdForScope(entry.scope, entry.projectId);
  const chunk = entryChunkText(entry);
  indexMemoryChunk(projectId, entry.scope, chunk);
  upsertZvecKnowledgeChunk({
    scope: entry.scope,
    projectId: entry.projectId,
    docId: entry.id,
    content: chunk,
    embed: opts?.embed,
  });
}

async function syncEntryToIndexAsync(
  entry: KnowledgeEntry,
  opts?: { embed?: boolean; acceptModelChange?: boolean },
): Promise<void> {
  const projectId = ftsProjectIdForScope(entry.scope, entry.projectId);
  const chunk = entryChunkText(entry);
  indexMemoryChunk(projectId, entry.scope, chunk);
  await upsertZvecKnowledgeChunkAsync({
    scope: entry.scope,
    projectId: entry.projectId,
    docId: entry.id,
    content: chunk,
    embed: opts?.embed,
    acceptModelChange: opts?.acceptModelChange,
  });
}

function rebuildScopeIndex(scope: "global" | "user", projectId?: string): void {
  const ftsProjectId = ftsProjectIdForScope(scope, projectId);
  clearMemoryIndex(ftsProjectId, scope);
  clearZvecKnowledgeScope(scope, projectId);
  for (const entry of listKnowledgeEntries(scope, projectId)) {
    syncEntryToIndex(entry);
  }
  optimizeZvecKnowledgeScope(scope, projectId);
}

async function rebuildScopeIndexAsync(
  scope: "global" | "user",
  projectId?: string,
  opts?: { includeEmbeddings?: boolean },
): Promise<number> {
  const ftsProjectId = ftsProjectIdForScope(scope, projectId);
  clearMemoryIndex(ftsProjectId, scope);
  clearZvecKnowledgeScope(scope, projectId);
  const entries = listKnowledgeEntries(scope, projectId);
  for (const entry of entries) {
    if (opts?.includeEmbeddings) {
      await syncEntryToIndexAsync(entry, {
        embed: true,
        acceptModelChange: true,
      });
    } else {
      syncEntryToIndex(entry, { embed: false });
    }
  }
  optimizeZvecKnowledgeScope(scope, projectId);
  return entries.length;
}

export function createKnowledgeEntry(
  scope: "global" | "user",
  input: CreateKnowledgeEntryInput,
  projectId?: string,
): KnowledgeEntry {
  const dir = entriesDirForScope(scope, projectId);
  mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const entry: KnowledgeEntry = {
    id: nanoid(),
    title: input.title.trim(),
    content: input.content.trim(),
    category: input.category ?? "fact",
    tags: input.tags ?? [],
    source: input.source ?? "manual",
    scope,
    projectId: scope === "user" ? projectId : undefined,
    createdAt: now,
    updatedAt: now,
  };
  const path = join(dir, `${entry.id}.md`);
  writeFileSync(path, formatKnowledgeEntryFile(entry), "utf8");
  syncEntryToIndex(entry);
  optimizeZvecKnowledgeScope(scope, projectId);
  return entry;
}

export function createImportedKnowledgeEntry(
  scope: "global" | "user",
  input: {
    title: string;
    content: string;
    sourceRefId: string;
    sourceUri: string;
  },
  projectId?: string,
): KnowledgeEntry {
  const dir = entriesDirForScope(scope, projectId);
  mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const entry: KnowledgeEntry = {
    id: nanoid(),
    title: input.title.trim(),
    content: input.content.trim(),
    category: "fact",
    tags: [],
    source: "imported",
    scope,
    projectId: scope === "user" ? projectId : undefined,
    sourceRefId: input.sourceRefId,
    sourceUri: input.sourceUri,
    createdAt: now,
    updatedAt: now,
  };
  const path = join(dir, `${entry.id}.md`);
  writeFileSync(path, formatKnowledgeEntryFile(entry), "utf8");
  syncEntryToIndex(entry, { embed: false });
  return entry;
}

export function deleteKnowledgeEntriesBySourceRef(
  scope: "global" | "user",
  sourceRefId: string,
  projectId?: string,
): number {
  const entries = listKnowledgeEntries(scope, projectId).filter(
    (e) => e.sourceRefId === sourceRefId,
  );
  for (const entry of entries) {
    const dir = entriesDirForScope(scope, projectId);
    const path = join(dir, `${entry.id}.md`);
    if (existsSync(path)) unlinkSync(path);
  }
  if (entries.length > 0) rebuildScopeIndex(scope, projectId);
  return entries.length;
}

function entryMatchesSourceFilter(
  entry: KnowledgeEntry,
  filter?: { sourceRefIds?: string[]; includeManual?: boolean },
): boolean {
  if (!filter) return true;
  if (!entry.sourceRefId) return filter.includeManual !== false;
  if (!filter.sourceRefIds || filter.sourceRefIds.length === 0) return false;
  return filter.sourceRefIds.includes(entry.sourceRefId);
}

function hitMatchesSourceFilter(
  content: string,
  filter?: { sourceRefIds?: string[]; includeManual?: boolean },
): boolean {
  if (!filter) return true;
  const refMatch = content.match(/来源引用：(\S+)/);
  if (!refMatch) return filter.includeManual !== false;
  if (!filter.sourceRefIds || filter.sourceRefIds.length === 0) return false;
  return filter.sourceRefIds.includes(refMatch[1]!);
}

function filterHitsBySource(
  hits: MemorySearchHit[],
  filter?: { sourceRefIds?: string[]; includeManual?: boolean },
): MemorySearchHit[] {
  if (!filter) return hits;
  return hits.filter((hit) => hitMatchesSourceFilter(hit.content, filter));
}

export function getKnowledgeEntry(
  scope: "global" | "user",
  entryId: string,
  projectId?: string,
): KnowledgeEntry | null {
  const dir = entriesDirForScope(scope, projectId);
  return readEntryFromFile(join(dir, `${entryId}.md`), entryId, scope, projectId);
}

export function updateKnowledgeEntry(
  scope: "global" | "user",
  entryId: string,
  patch: UpdateKnowledgeEntryInput,
  projectId?: string,
): KnowledgeEntry | null {
  const existing = getKnowledgeEntry(scope, entryId, projectId);
  if (!existing) return null;
  const next: KnowledgeEntry = {
    ...existing,
    title: patch.title?.trim() ?? existing.title,
    content: patch.content?.trim() ?? existing.content,
    category: patch.category ?? existing.category,
    tags: patch.tags ?? existing.tags,
    updatedAt: new Date().toISOString(),
  };
  const dir = entriesDirForScope(scope, projectId);
  writeFileSync(join(dir, `${entryId}.md`), formatKnowledgeEntryFile(next), "utf8");
  rebuildScopeIndex(scope, projectId);
  return next;
}

export function deleteKnowledgeEntry(
  scope: "global" | "user",
  entryId: string,
  projectId?: string,
): boolean {
  const dir = entriesDirForScope(scope, projectId);
  const path = join(dir, `${entryId}.md`);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  rebuildScopeIndex(scope, projectId);
  return true;
}

function splitMemorySections(content: string): Array<{ heading: string; body: string }> {
  const parts = content.split(/^## /m).filter(Boolean);
  if (parts.length === 0) return [{ heading: "项目记忆", body: content.trim() }];
  return parts.map((part) => {
    const nl = part.indexOf("\n");
    if (nl === -1) return { heading: part.trim(), body: "" };
    return {
      heading: part.slice(0, nl).trim(),
      body: part.slice(nl + 1).trim(),
    };
  });
}

export function readRuntimeMemory(
  workspaceRoot: string,
  projectId: string,
): string | undefined {
  const path = runtimeMemoryFile(workspaceRoot, projectId);
  if (!existsSync(path)) return undefined;
  try {
    return readFileSync(path, "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

export function ensureRuntimeMemoryInitialized(
  workspaceRoot: string,
  projectId: string,
): string {
  const path = runtimeMemoryFile(workspaceRoot, projectId);
  if (existsSync(path)) {
    const existing = readRuntimeMemory(workspaceRoot, projectId);
    if (existing) return existing;
  }
  mkdirSync(dirname(path), { recursive: true });
  ensureWorkspaceOpenxGitignore(workspaceRoot);
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const initial = [
    "## 项目概况",
    `初始化时间：${stamp}`,
    "（对话推进后将自动补充运行知识）",
    "",
    "## 技术约定",
    "（待补充）",
    "",
    "## 蒸馏经验",
    "（失败/返工/审查经验将自动追加）",
    "",
  ].join("\n");
  writeFileSync(path, initial, "utf8");
  syncRuntimeMemoryIndex(projectId, initial);
  return initial;
}

export function syncRuntimeMemoryIndex(
  projectId: string,
  content: string,
  opts?: { embed?: boolean },
): void {
  clearMemoryIndex(projectId, RUNTIME_SCOPE);
  clearZvecKnowledgeScope("runtime", projectId);
  const trimmed = content.trim();
  if (!trimmed) return;
  for (const section of splitMemorySections(trimmed)) {
    const chunk = `## ${section.heading}\n${section.body}`.trim();
    if (!chunk) continue;
    indexMemoryChunk(projectId, RUNTIME_SCOPE, chunk);
    upsertZvecKnowledgeChunk({
      scope: "runtime",
      projectId,
      docId: runtimeSectionDocId(section.heading),
      content: chunk,
      embed: opts?.embed,
    });
  }
  optimizeZvecKnowledgeScope("runtime", projectId);
}

export async function syncRuntimeMemoryIndexAsync(
  projectId: string,
  content: string,
  opts?: { embed?: boolean; acceptModelChange?: boolean },
): Promise<number> {
  clearMemoryIndex(projectId, RUNTIME_SCOPE);
  clearZvecKnowledgeScope("runtime", projectId);
  const trimmed = content.trim();
  if (!trimmed) return 0;
  let count = 0;
  for (const section of splitMemorySections(trimmed)) {
    const chunk = `## ${section.heading}\n${section.body}`.trim();
    if (!chunk) continue;
    indexMemoryChunk(projectId, RUNTIME_SCOPE, chunk);
    await upsertZvecKnowledgeChunkAsync({
      scope: "runtime",
      projectId,
      docId: runtimeSectionDocId(section.heading),
      content: chunk,
      embed: opts?.embed,
      acceptModelChange: opts?.acceptModelChange,
    });
    count += 1;
  }
  optimizeZvecKnowledgeScope("runtime", projectId);
  return count;
}

export function appendRuntimeMemorySection(
  workspaceRoot: string,
  projectId: string,
  heading: string,
  body: string,
): string {
  ensureRuntimeMemoryInitialized(workspaceRoot, projectId);
  const path = runtimeMemoryFile(workspaceRoot, projectId);
  const existing = readRuntimeMemory(workspaceRoot, projectId) ?? "";
  const block = `## ${heading}\n${body.trim()}\n`;
  const sections = splitMemorySections(existing);
  const targetHeading = heading.trim();
  const replacement = { heading: targetHeading, body: body.trim() };
  const existingIndex = sections.findIndex((section) => section.heading === targetHeading);
  if (existingIndex >= 0) {
    sections[existingIndex] = replacement;
  } else {
    sections.push(replacement);
  }
  const next = sections.length > 0
    ? sections.map((section) => `## ${section.heading}\n${section.body.trim()}`).join("\n\n")
    : block;
  writeFileSync(path, `${next.trim()}\n`, "utf8");
  syncRuntimeMemoryIndex(projectId, next);
  return next;
}

export function searchScopedKnowledge(
  scope: KnowledgeScope,
  query: string,
  opts?: {
    projectId?: string;
    limit?: number;
    sourceRefIds?: string[];
    includeManual?: boolean;
  },
): MemorySearchHit[] {
  const zvecHits = searchZvecKnowledge(scope, query, opts);
  let hits: MemorySearchHit[];
  if (zvecHits !== null) {
    hits = zvecHits;
  } else {
    const projectId = ftsProjectIdForScope(scope, opts?.projectId);
    hits = searchMemoryFts(projectId, query, opts?.limit ?? 5, scope);
  }
  return filterHitsBySource(hits, opts);
}

export async function searchScopedKnowledgeAsync(
  scope: KnowledgeScope,
  query: string,
  opts?: {
    projectId?: string;
    limit?: number;
    sourceRefIds?: string[];
    includeManual?: boolean;
  },
): Promise<MemorySearchHit[]> {
  const zvecHits = await searchZvecKnowledgeAsync(scope, query, opts);
  let hits: MemorySearchHit[];
  if (zvecHits !== null) {
    hits = zvecHits;
  } else {
    const projectId = ftsProjectIdForScope(scope, opts?.projectId);
    hits = searchMemoryFts(projectId, query, opts?.limit ?? 5, scope);
  }
  return filterHitsBySource(hits, opts);
}

/** 多 scope 检索结果按 rank 全局排序并去重 */
export function mergeKnowledgeSearchHits(hits: MemorySearchHit[]): MemorySearchHit[] {
  const seen = new Set<string>();
  const merged: MemorySearchHit[] = [];
  for (const hit of [...hits].sort((a, b) => a.rank - b.rank)) {
    const key = `${hit.scope}:${hit.projectId}:${hit.content.slice(0, 160)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(hit);
  }
  return merged;
}

export class KnowledgeRebuildInProgressError extends Error {
  constructor() {
    super("Knowledge index rebuild already in progress");
    this.name = "KnowledgeRebuildInProgressError";
  }
}

let rebuildInFlight: Promise<KnowledgeIndexRebuildSummary> | null = null;

function clipText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…（已截断）`;
}

function loadUserKnowledgeContext(
  projectId: string,
  query?: string,
  filter?: { sourceRefIds?: string[]; includeManual?: boolean },
): string | undefined {
  if (query?.trim()) {
    const hits = searchScopedKnowledge("user", query, { projectId, limit: 4, ...filter });
    const formatted = formatKnowledgeHitsForPrompt("项目用户知识（检索命中）", hits);
    if (formatted) return formatted;
  }
  const entries = listKnowledgeEntries("user", projectId).filter((e) =>
    entryMatchesSourceFilter(e, filter),
  );
  if (entries.length === 0) return undefined;
  const body = entries
    .slice(0, 8)
    .map((entry) => {
      const src = entry.sourceUri ? `（来源：${entry.sourceUri}）\n` : "";
      return `### ${entry.title}\n${src}${entry.content.trim()}`;
    })
    .join("\n\n");
  return clipText(`## 项目用户知识\n${body}`, 2400);
}

async function loadUserKnowledgeContextAsync(
  projectId: string,
  query?: string,
  filter?: { sourceRefIds?: string[]; includeManual?: boolean },
): Promise<string | undefined> {
  if (query?.trim()) {
    const hits = await searchScopedKnowledgeAsync("user", query, {
      projectId,
      limit: 4,
      ...filter,
    });
    const formatted = formatKnowledgeHitsForPrompt("项目用户知识（检索命中）", hits);
    if (formatted) return formatted;
  }
  return loadUserKnowledgeContext(projectId, undefined, filter);
}

function loadGlobalKnowledgeContext(
  query?: string,
  filter?: { sourceRefIds?: string[]; includeManual?: boolean },
): string | undefined {
  if (query?.trim()) {
    const hits = searchScopedKnowledge("global", query, { limit: 4, ...filter });
    const formatted = formatKnowledgeHitsForPrompt("全局知识（检索命中）", hits);
    if (formatted) return formatted;
  }
  const entries = listKnowledgeEntries("global").filter((e) =>
    entryMatchesSourceFilter(e, filter),
  );
  if (entries.length === 0) return undefined;
  const body = entries
    .slice(0, 8)
    .map((entry) => {
      const src = entry.sourceUri ? `（来源：${entry.sourceUri}）\n` : "";
      return `### ${entry.title}\n${src}${entry.content.trim()}`;
    })
    .join("\n\n");
  return clipText(`## 全局知识\n${body}`, 2400);
}

async function loadGlobalKnowledgeContextAsync(
  query?: string,
  filter?: { sourceRefIds?: string[]; includeManual?: boolean },
): Promise<string | undefined> {
  if (query?.trim()) {
    const hits = await searchScopedKnowledgeAsync("global", query, { limit: 4, ...filter });
    const formatted = formatKnowledgeHitsForPrompt("全局知识（检索命中）", hits);
    if (formatted) return formatted;
  }
  return loadGlobalKnowledgeContext(undefined, filter);
}

function loadRuntimeKnowledgeContext(
  workspaceRoot: string,
  projectId: string,
  query?: string,
): string | undefined {
  if (query?.trim()) {
    const hits = searchScopedKnowledge("runtime", query, { projectId, limit: 4 });
    const formatted = formatKnowledgeHitsForPrompt("项目运行知识（检索命中）", hits);
    if (formatted) return formatted;
  }
  const memory = readRuntimeMemory(workspaceRoot, projectId);
  if (!memory) return undefined;
  return clipText(`## 项目运行知识（MEMORY.md）\n${memory}`, 2400);
}

async function loadRuntimeKnowledgeContextAsync(
  workspaceRoot: string,
  projectId: string,
  query?: string,
): Promise<string | undefined> {
  if (query?.trim()) {
    const hits = await searchScopedKnowledgeAsync("runtime", query, { projectId, limit: 4 });
    const formatted = formatKnowledgeHitsForPrompt("项目运行知识（检索命中）", hits);
    if (formatted) return formatted;
  }
  return loadRuntimeKnowledgeContext(workspaceRoot, projectId);
}

/** Coach prompt 注入：调度台仅 global；项目对话合并 user + runtime + global(只读) */
export function loadKnowledgeContextForCoach(opts: {
  isSystemMain: boolean;
  projectId?: string;
  workspaceRoot: string;
  query?: string;
}): string | undefined {
  const blocks = buildKnowledgeContextBlocksSync(opts);
  return blocks.length > 0 ? blocks.join("\n\n") : undefined;
}

/** Coach prompt 注入（混合/向量检索） */
export async function loadKnowledgeContextForCoachAsync(opts: {
  isSystemMain: boolean;
  projectId?: string;
  workspaceRoot: string;
  query?: string;
  knowledgeSelection?: KnowledgeContextSelection;
  knowledgeCatalogSummary?: string;
  scopeFlags?: {
    includeGlobal: boolean;
    includeProject: boolean;
    includeRuntime: boolean;
    globalSourceIds: string[];
    projectSourceIds: string[];
  };
}): Promise<string | undefined> {
  const blocks: string[] = [];
  if (opts.knowledgeCatalogSummary) blocks.push(opts.knowledgeCatalogSummary);

  const isAll = opts.knowledgeSelection?.mode !== "custom";
  const flags = opts.scopeFlags ?? {
    includeGlobal: true,
    includeProject: true,
    includeRuntime: true,
    globalSourceIds: [],
    projectSourceIds: [],
  };

  const globalFilter =
    isAll
      ? undefined
      : {
          sourceRefIds: flags.globalSourceIds,
          includeManual: flags.includeGlobal,
        };
  const projectFilter =
    isAll
      ? undefined
      : {
          sourceRefIds: flags.projectSourceIds,
          includeManual: flags.includeProject,
        };

  if (opts.isSystemMain) {
    const global = await loadGlobalKnowledgeContextAsync(opts.query, globalFilter);
    if (global) blocks.push(global);
  } else if (opts.projectId) {
    ensureRuntimeMemoryInitialized(opts.workspaceRoot, opts.projectId);
    if (flags.includeProject) {
      const user = await loadUserKnowledgeContextAsync(
        opts.projectId,
        opts.query,
        projectFilter,
      );
      if (user) blocks.push(user);
    }
    if (flags.includeRuntime) {
      const runtime = await loadRuntimeKnowledgeContextAsync(
        opts.workspaceRoot,
        opts.projectId,
        opts.query,
      );
      if (runtime) blocks.push(runtime);
    }
    if (flags.includeGlobal && opts.query?.trim()) {
      const globalHits = await searchScopedKnowledgeAsync("global", opts.query, {
        limit: 2,
        ...globalFilter,
      });
      const globalReadonly = formatKnowledgeHitsForPrompt(
        "全局知识（只读参考）",
        globalHits,
      );
      if (globalReadonly) blocks.push(globalReadonly);
    }
  }
  return blocks.length > 0 ? blocks.join("\n\n") : undefined;
}

function buildKnowledgeContextBlocksSync(opts: {
  isSystemMain: boolean;
  projectId?: string;
  workspaceRoot: string;
  query?: string;
}): string[] {
  const blocks: string[] = [];
  if (opts.isSystemMain) {
    const global = loadGlobalKnowledgeContext(opts.query);
    if (global) blocks.push(global);
  } else if (opts.projectId) {
    ensureRuntimeMemoryInitialized(opts.workspaceRoot, opts.projectId);
    const user = loadUserKnowledgeContext(opts.projectId, opts.query);
    if (user) blocks.push(user);
    const runtime = loadRuntimeKnowledgeContext(
      opts.workspaceRoot,
      opts.projectId,
      opts.query,
    );
    if (runtime) blocks.push(runtime);
    if (opts.query?.trim()) {
      const globalHits = searchScopedKnowledge("global", opts.query, { limit: 2 });
      const globalReadonly = formatKnowledgeHitsForPrompt(
        "全局知识（只读参考）",
        globalHits,
      );
      if (globalReadonly) blocks.push(globalReadonly);
    }
  }
  return blocks;
}

/** Executor prompt 注入：user 全量 + runtime 截断，不含 global */
export function loadKnowledgeContextForExecutor(
  workspaceRoot: string,
  projectId: string,
): string | undefined {
  ensureRuntimeMemoryInitialized(workspaceRoot, projectId);
  const blocks: string[] = [];
  const user = loadUserKnowledgeContext(projectId);
  if (user) blocks.push(user);
  const runtime = loadRuntimeKnowledgeContext(workspaceRoot, projectId);
  if (runtime) blocks.push(clipText(runtime, 1800));
  return blocks.length > 0 ? blocks.join("\n\n") : undefined;
}

export function promoteUserEntryToGlobal(
  projectId: string,
  entryId: string,
): KnowledgeEntry | null {
  const source = getKnowledgeEntry("user", entryId, projectId);
  if (!source) return null;
  const promoted = createKnowledgeEntry("global", {
    title: source.title,
    content: source.content,
    category: source.category,
    tags: source.tags,
    source: "promoted",
  });
  return promoted;
}

export function promoteRuntimeSectionToUser(
  workspaceRoot: string,
  projectId: string,
  heading: string,
): KnowledgeEntry | null {
  const memory = readRuntimeMemory(workspaceRoot, projectId);
  if (!memory) return null;
  const section = splitMemorySections(memory).find((s) => s.heading === heading.trim());
  if (!section || !section.body.trim()) return null;
  return createKnowledgeEntry(
    "user",
    {
      title: section.heading,
      content: section.body,
      category: "lesson",
      source: "promoted",
    },
    projectId,
  );
}

export function listRuntimeMemorySections(
  workspaceRoot: string,
  projectId: string,
): Array<{ heading: string; preview: string }> {
  const memory = readRuntimeMemory(workspaceRoot, projectId);
  if (!memory) return [];
  return splitMemorySections(memory).map((section) => ({
    heading: section.heading,
    preview: section.body.slice(0, 160),
  }));
}

/** 启动或测试时可重建全部索引 */
export function rebuildAllKnowledgeIndexes(projectIds: string[]): void {
  rebuildScopeIndex("global");
  for (const projectId of projectIds) {
    rebuildScopeIndex("user", projectId);
  }
}

export type KnowledgeIndexRebuildSummary = {
  globalEntries: number;
  userEntries: number;
  runtimeSections: number;
  projects: number;
  embeddingAttempted: boolean;
  embeddingAvailable: boolean;
  embeddingDimension?: number;
};

export async function rebuildKnowledgeIndexesAsync(opts?: {
  projectIds?: string[];
  includeEmbeddings?: boolean;
}): Promise<KnowledgeIndexRebuildSummary> {
  if (rebuildInFlight) {
    throw new KnowledgeRebuildInProgressError();
  }
  rebuildInFlight = rebuildKnowledgeIndexesInner(opts).finally(() => {
    rebuildInFlight = null;
  });
  return rebuildInFlight;
}

async function rebuildKnowledgeIndexesInner(opts?: {
  projectIds?: string[];
  includeEmbeddings?: boolean;
}): Promise<KnowledgeIndexRebuildSummary> {
  const projects = opts?.projectIds
    ? opts.projectIds.map((id) => getProjectById(id)).filter((p): p is NonNullable<typeof p> => Boolean(p))
    : listProjects();
  if (opts?.includeEmbeddings && isKnowledgeVectorSearchEnabled()) {
    await probeKnowledgeEmbedding({ acceptModelChange: true });
  }
  let userEntries = 0;
  let runtimeSections = 0;
  const globalEntries = await rebuildScopeIndexAsync("global", undefined, {
    includeEmbeddings: opts?.includeEmbeddings,
  });
  for (const project of projects) {
    userEntries += await rebuildScopeIndexAsync("user", project.id, {
      includeEmbeddings: opts?.includeEmbeddings,
    });
    if (project.workspaceDir) {
      const memory = readRuntimeMemory(resolveWorkspaceRoot(project.workspaceDir), project.id);
      if (memory) {
        if (opts?.includeEmbeddings) {
          runtimeSections += await syncRuntimeMemoryIndexAsync(project.id, memory, {
            embed: true,
            acceptModelChange: true,
          });
        } else {
          syncRuntimeMemoryIndex(project.id, memory, { embed: false });
          runtimeSections += splitMemorySections(memory).filter((s) => s.body.trim()).length;
        }
      }
    }
  }
  flushPendingDirtyReindex();
  return {
    globalEntries,
    userEntries,
    runtimeSections,
    projects: projects.length,
    embeddingAttempted: Boolean(opts?.includeEmbeddings && isKnowledgeVectorSearchEnabled()),
    embeddingAvailable: isKnowledgeEmbeddingAvailable(),
    embeddingDimension: getStoredEmbeddingDimension(),
  };
}

export function getKnowledgeIndexHealth(): {
  zvecEnabled: boolean;
  zvecRoot: string;
  searchMode: string;
  vectorSearchEnabled: boolean;
  embeddingAvailable: boolean;
  embeddingStatus: string;
  embeddingDimension?: number;
  embeddingModelRef?: string;
  currentEmbeddingModelRef?: string;
  sqliteFallbackReady: boolean;
  needsRebuild: boolean;
  needsRebuildReasons: string[];
  rebuildInProgress: boolean;
  zvecLastErrors: ReturnType<typeof getZvecLastErrors>;
  zvecDocCount?: number;
  markdownCount: number;
  pendingDirtyScopes: string[];
  projects: number;
  globalEntries: number;
  userEntries: number;
  runtimeSections: number;
  projectScopes: Array<{
    projectId: string;
    userEntries: number;
    runtimeSections: number;
    hasRuntimeMemory: boolean;
  }>;
} {
  const projects = listProjects();
  let userEntries = 0;
  let runtimeSections = 0;
  const projectScopes: Array<{
    projectId: string;
    userEntries: number;
    runtimeSections: number;
    hasRuntimeMemory: boolean;
  }> = [];
  for (const project of projects) {
    const projectUserEntries = listKnowledgeEntries("user", project.id).length;
    userEntries += projectUserEntries;
    let projectRuntimeSections = 0;
    let hasRuntimeMemory = false;
    if (project.workspaceDir) {
      const memory = readRuntimeMemory(resolveWorkspaceRoot(project.workspaceDir), project.id);
      hasRuntimeMemory = Boolean(memory);
      if (memory) {
        projectRuntimeSections = splitMemorySections(memory).filter((s) => s.body.trim()).length;
        runtimeSections += projectRuntimeSections;
      }
    }
    projectScopes.push({
      projectId: project.id,
      userEntries: projectUserEntries,
      runtimeSections: projectRuntimeSections,
      hasRuntimeMemory,
    });
  }
  const zvecEnabled = isZvecKnowledgeEnabled();
  const vectorSearchEnabled = isKnowledgeVectorSearchEnabled();
  const embeddingDimension = getStoredEmbeddingDimension();
  const embeddingAvailable = isKnowledgeEmbeddingAvailable();
  const embeddingModelRef = getStoredEmbeddingModelRef();
  const currentEmbeddingModelRef = getCurrentKnowledgeEmbeddingModelRef();
  const modelChanged = hasKnowledgeEmbeddingModelChanged();
  const embeddingStatus = !vectorSearchEnabled
    ? "disabled"
    : !currentEmbeddingModelRef
      ? "not_configured"
      : modelChanged
        ? "model_changed"
        : embeddingAvailable
          ? "available"
          : "unavailable";
  const needsRebuildReasons = [
    ...(zvecEnabled && vectorSearchEnabled && modelChanged ? ["embedding_model_changed"] : []),
  ];
  const globalEntries = listKnowledgeEntries("global").length;
  const markdownCount = globalEntries + userEntries + runtimeSections;
  let zvecDocCount: number | undefined;
  if (zvecEnabled) {
    let total = 0;
    let any = false;
    const globalCount = getZvecCollectionDocCount("global");
    if (typeof globalCount === "number") {
      total += globalCount;
      any = true;
    }
    for (const project of projects) {
      const userCount = getZvecCollectionDocCount("user", project.id);
      const runtimeCount = getZvecCollectionDocCount("runtime", project.id);
      if (typeof userCount === "number") {
        total += userCount;
        any = true;
      }
      if (typeof runtimeCount === "number") {
        total += runtimeCount;
        any = true;
      }
    }
    if (any) zvecDocCount = total;
  }
  return {
    zvecEnabled,
    zvecRoot: getZvecRoot(),
    searchMode: resolveKnowledgeSearchMode(),
    vectorSearchEnabled,
    embeddingAvailable,
    embeddingStatus,
    embeddingDimension,
    embeddingModelRef,
    currentEmbeddingModelRef,
    sqliteFallbackReady: true,
    needsRebuild: needsRebuildReasons.length > 0,
    needsRebuildReasons,
    rebuildInProgress: rebuildInFlight !== null,
    zvecLastErrors: getZvecLastErrors(),
    zvecDocCount,
    markdownCount,
    pendingDirtyScopes: getPendingDirtyScopeKeys(),
    projects: projects.length,
    globalEntries,
    userEntries,
    runtimeSections,
    projectScopes,
  };
}

// --- 兼容旧 memory-store 导出名 ---
export const projectMemoryFile = runtimeMemoryFile;
export const readProjectMemory = readRuntimeMemory;
export function syncProjectMemoryIndex(projectId: string, content: string): void {
  syncRuntimeMemoryIndex(projectId, content);
}
export function appendProjectMemorySection(
  workspaceRoot: string,
  projectId: string,
  heading: string,
  body: string,
): string {
  return appendRuntimeMemorySection(workspaceRoot, projectId, heading, body);
}
export function loadProjectMemoryContext(
  workspaceRoot: string,
  projectId: string,
  query?: string,
): string | undefined {
  return loadKnowledgeContextForCoach({
    isSystemMain: false,
    projectId,
    workspaceRoot,
    query,
  });
}

registerZvecReindexHandler((scope, projectId) => {
  if (scope === "global") {
    rebuildScopeIndex("global");
    return;
  }
  if (!projectId) return;
  rebuildScopeIndex("user", projectId);
  const project = getProjectById(projectId);
  if (!project?.workspaceDir) return;
  const memory = readRuntimeMemory(resolveWorkspaceRoot(project.workspaceDir), projectId);
  if (memory) syncRuntimeMemoryIndex(projectId, memory);
});
