import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { nanoid } from "nanoid";
import type {
  CreateKnowledgeSourceInput,
  KnowledgeContextSelection,
  KnowledgeSourceRef,
  UpdateKnowledgeSourceInput,
} from "@openx/shared";
import { formatKnowledgeSelectionSummaryBlock, inferKnowledgeSourceKind } from "@openx/shared";
import { getKnowledgeRoot } from "./paths.js";
import {
  createImportedKnowledgeEntry,
  deleteKnowledgeEntriesBySourceRef,
} from "./knowledge-store.js";
import { optimizeZvecKnowledgeScope } from "./zvec-knowledge-index.js";
import {
  deriveDefaultKnowledgeSourceLabel,
  distillKnowledgeSourceContent,
} from "./knowledge-source-distill.js";
import {
  assertKnowledgeImportUrlAllowed,
  assertKnowledgeSourceUriAllowed,
  parseKnowledgeImportUrls,
} from "./knowledge-import-guard.js";
import { getProjectById } from "./db.js";
import { resolveWorkspaceRoot } from "./workspace-path.js";

export { KnowledgeImportGuardError } from "./knowledge-import-guard.js";

const SOURCES_FILE = "sources.json";
const MAX_FILE_BYTES = 512_000;
const MAX_FILES_PER_SOURCE = 200;
const MAX_URLS_PER_SOURCE = 50;
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".openx",
  "zvec",
]);

type SourcesManifest = { sources: KnowledgeSourceRef[] };

function sourcesManifestPath(scope: "global" | "user", projectId?: string): string {
  if (scope === "global") return join(getKnowledgeRoot(), "global", SOURCES_FILE);
  if (!projectId) throw new Error("projectId required");
  return join(getKnowledgeRoot(), "projects", projectId, SOURCES_FILE);
}

function readManifest(scope: "global" | "user", projectId?: string): SourcesManifest {
  const path = sourcesManifestPath(scope, projectId);
  if (!existsSync(path)) return { sources: [] };
  try {
    return JSON.parse(readFileSync(path, "utf8")) as SourcesManifest;
  } catch {
    return { sources: [] };
  }
}

function writeManifest(
  scope: "global" | "user",
  manifest: SourcesManifest,
  projectId?: string,
): void {
  const path = sourcesManifestPath(scope, projectId);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 2), "utf8");
}

export function listKnowledgeSources(
  scope: "global" | "user",
  projectId?: string,
): KnowledgeSourceRef[] {
  return readManifest(scope, projectId).sources.sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export function getKnowledgeSource(
  scope: "global" | "user",
  sourceId: string,
  projectId?: string,
): KnowledgeSourceRef | null {
  return listKnowledgeSources(scope, projectId).find((s) => s.id === sourceId) ?? null;
}

function shouldSkipDir(name: string): boolean {
  return SKIP_DIR_NAMES.has(name) || name.startsWith(".");
}

function collectPathFiles(
  rootPath: string,
  includePatterns?: string[],
  excludePatterns?: string[],
): string[] {
  const abs = resolve(rootPath);
  if (!existsSync(abs)) return [];
  const stat = statSync(abs);
  const allowedExt = new Set([".md", ".mdx", ".txt"]);
  const files: string[] = [];

  const matchesPatterns = (rel: string): boolean => {
    if (excludePatterns?.some((p) => rel.includes(p))) return false;
    if (includePatterns && includePatterns.length > 0) {
      return includePatterns.some((p) => rel.includes(p));
    }
    return true;
  };

  const walk = (dir: string) => {
    if (files.length >= MAX_FILES_PER_SOURCE) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (files.length >= MAX_FILES_PER_SOURCE) break;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (shouldSkipDir(name)) continue;
        walk(full);
        continue;
      }
      if (!st.isFile()) continue;
      const ext = extname(name).toLowerCase();
      if (!allowedExt.has(ext)) continue;
      if (st.size > MAX_FILE_BYTES) continue;
      const rel = full.slice(abs.length).replace(/^[/\\]/, "");
      if (!matchesPatterns(rel)) continue;
      files.push(full);
    }
  };

  if (stat.isFile()) {
    const ext = extname(abs).toLowerCase();
    if (allowedExt.has(ext) && stat.size <= MAX_FILE_BYTES) files.push(abs);
  } else if (stat.isDirectory()) {
    walk(abs);
  }
  return files;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchUrlText(url: string): Promise<string> {
  assertKnowledgeImportUrlAllowed(url);
  const res = await fetch(url, {
    headers: { "User-Agent": "OpenX-Knowledge-Importer/1.0" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "";
  const raw = await res.text();
  if (contentType.includes("html")) return stripHtml(raw).slice(0, MAX_FILE_BYTES);
  return raw.slice(0, MAX_FILE_BYTES);
}

function parseUrlList(uri: string): string[] {
  return parseKnowledgeImportUrls(uri).slice(0, MAX_URLS_PER_SOURCE);
}

function resolveImportWorkspaceRoot(
  scope: "global" | "user",
  projectId?: string,
  workspaceRoot?: string,
): string | undefined {
  if (scope !== "user") return undefined;
  if (workspaceRoot?.trim()) return resolveWorkspaceRoot(workspaceRoot);
  if (!projectId) return undefined;
  const project = getProjectById(projectId);
  if (!project) return undefined;
  return resolveWorkspaceRoot(project.workspaceDir);
}

function importFieldsChanged(
  existing: KnowledgeSourceRef,
  next: KnowledgeSourceRef,
): boolean {
  return (
    existing.uri !== next.uri ||
    existing.kind !== next.kind ||
    JSON.stringify(existing.includePatterns ?? []) !==
      JSON.stringify(next.includePatterns ?? []) ||
    JSON.stringify(existing.excludePatterns ?? []) !==
      JSON.stringify(next.excludePatterns ?? [])
  );
}

async function importSourceContent(
  source: KnowledgeSourceRef,
  workspaceRoot?: string,
): Promise<{ docCount: number; error?: string; label?: string }> {
  deleteKnowledgeEntriesBySourceRef(source.scope, source.id, source.projectId);
  try {
    const chunks: string[] = [];

    if (source.kind === "path") {
      assertKnowledgeSourceUriAllowed(source.uri, "path", source.scope, workspaceRoot);
      const files = collectPathFiles(
        source.uri,
        source.includePatterns,
        source.excludePatterns,
      );
      for (const filePath of files) {
        const raw = readFileSync(filePath, "utf8").trim();
        if (!raw) continue;
        chunks.push(`## ${basename(filePath)}\n\n${raw}`);
      }
    } else {
      const urls = parseUrlList(source.uri);
      for (const url of urls) {
        const text = await fetchUrlText(url);
        if (!text.trim()) continue;
        chunks.push(`## ${url}\n\n${text}`);
      }
    }

    if (chunks.length === 0) {
      return { docCount: 0, error: "未找到可导入的文本内容" };
    }

    const combined = chunks.join("\n\n");
    const distilled = await distillKnowledgeSourceContent({
      uri: source.uri,
      kind: source.kind,
      rawText: combined,
    });

    createImportedKnowledgeEntry(
      source.scope,
      {
        title: distilled.title,
        content: distilled.summary,
        sourceRefId: source.id,
        sourceUri: source.uri,
      },
      source.projectId,
    );
    optimizeZvecKnowledgeScope(source.scope, source.projectId);
    return { docCount: 1, label: distilled.title };
  } catch (err) {
    return {
      docCount: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function createKnowledgeSource(
  scope: "global" | "user",
  input: CreateKnowledgeSourceInput,
  projectId?: string,
  opts?: { workspaceRoot?: string },
): Promise<KnowledgeSourceRef> {
  const now = new Date().toISOString();
  const uri = input.uri.trim();
  const kind = input.kind ?? inferKnowledgeSourceKind(uri);
  const workspaceRoot = resolveImportWorkspaceRoot(scope, projectId, opts?.workspaceRoot);
  assertKnowledgeSourceUriAllowed(uri, kind, scope, workspaceRoot);
  const provisionalLabel =
    input.label?.trim() ||
    deriveDefaultKnowledgeSourceLabel(uri, kind);
  const source: KnowledgeSourceRef = {
    id: nanoid(),
    scope,
    projectId: scope === "user" ? projectId : undefined,
    kind,
    label: provisionalLabel,
    uri,
    includePatterns: input.includePatterns,
    excludePatterns: input.excludePatterns,
    status: "indexing",
    docCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  const manifest = readManifest(scope, projectId);
  manifest.sources.unshift(source);
  writeManifest(scope, manifest, projectId);

  const result = await importSourceContent(source, workspaceRoot);
  const next: KnowledgeSourceRef = {
    ...source,
    label: result.label?.trim() || source.label,
    status: result.error ? "error" : "ready",
    docCount: result.docCount,
    error: result.error,
    lastIndexedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const updated = manifest.sources.map((s) => (s.id === source.id ? next : s));
  writeManifest(scope, { sources: updated }, projectId);
  return next;
}

export async function reindexKnowledgeSource(
  scope: "global" | "user",
  sourceId: string,
  projectId?: string,
  opts?: { workspaceRoot?: string },
): Promise<KnowledgeSourceRef | null> {
  const manifest = readManifest(scope, projectId);
  const existing = manifest.sources.find((s) => s.id === sourceId);
  if (!existing) return null;
  const workspaceRoot = resolveImportWorkspaceRoot(scope, projectId, opts?.workspaceRoot);

  const indexing: KnowledgeSourceRef = {
    ...existing,
    status: "indexing",
    error: undefined,
    updatedAt: new Date().toISOString(),
  };
  writeManifest(
    scope,
    { sources: manifest.sources.map((s) => (s.id === sourceId ? indexing : s)) },
    projectId,
  );

  const result = await importSourceContent(indexing, workspaceRoot);
  const next: KnowledgeSourceRef = {
    ...indexing,
    label: result.label?.trim() || indexing.label,
    status: result.error ? "error" : "ready",
    docCount: result.docCount,
    error: result.error,
    lastIndexedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeManifest(
    scope,
    { sources: manifest.sources.map((s) => (s.id === sourceId ? next : s)) },
    projectId,
  );
  return next;
}

export async function updateKnowledgeSourceMeta(
  scope: "global" | "user",
  sourceId: string,
  patch: UpdateKnowledgeSourceInput,
  projectId?: string,
  opts?: { workspaceRoot?: string },
): Promise<KnowledgeSourceRef | null> {
  const manifest = readManifest(scope, projectId);
  const existing = manifest.sources.find((s) => s.id === sourceId);
  if (!existing) return null;
  const uri = patch.uri?.trim() ?? existing.uri;
  const next: KnowledgeSourceRef = {
    ...existing,
    label: patch.label?.trim() ?? existing.label,
    uri,
    kind: patch.uri ? inferKnowledgeSourceKind(uri) : existing.kind,
    includePatterns: patch.includePatterns ?? existing.includePatterns,
    excludePatterns: patch.excludePatterns ?? existing.excludePatterns,
    updatedAt: new Date().toISOString(),
  };
  const workspaceRoot = resolveImportWorkspaceRoot(scope, projectId, opts?.workspaceRoot);
  if (importFieldsChanged(existing, next)) {
    assertKnowledgeSourceUriAllowed(next.uri, next.kind, scope, workspaceRoot);
    writeManifest(
      scope,
      {
        sources: manifest.sources.map((s) =>
          s.id === sourceId ? { ...next, status: "indexing" as const, error: undefined } : s,
        ),
      },
      projectId,
    );
    return reindexKnowledgeSource(scope, sourceId, projectId);
  }
  writeManifest(
    scope,
    { sources: manifest.sources.map((s) => (s.id === sourceId ? next : s)) },
    projectId,
  );
  return next;
}

export function deleteKnowledgeSource(
  scope: "global" | "user",
  sourceId: string,
  projectId?: string,
): boolean {
  const manifest = readManifest(scope, projectId);
  if (!manifest.sources.some((s) => s.id === sourceId)) return false;
  deleteKnowledgeEntriesBySourceRef(scope, sourceId, projectId);
  writeManifest(
    scope,
    { sources: manifest.sources.filter((s) => s.id !== sourceId) },
    projectId,
  );
  return true;
}

export function buildKnowledgeCatalogSummary(opts: {
  isSystemMain: boolean;
  projectId?: string;
  selection?: KnowledgeContextSelection;
}): {
  summary: string;
  enabledSourceIds: string[];
  includeGlobal: boolean;
  includeProject: boolean;
  includeRuntime: boolean;
  globalSourceIds: string[];
  projectSourceIds: string[];
} {
  const selection = opts.selection ?? { mode: "all" as const };
  const globalSources = listKnowledgeSources("global");
  const projectSources = opts.projectId
    ? listKnowledgeSources("user", opts.projectId)
    : [];

  const enabledLabels: string[] = [];
  const disabledLabels: string[] = [];
  const enabledSourceIds: string[] = [];
  const globalSourceIds: string[] = [];
  const projectSourceIds: string[] = [];

  const isAll = selection.mode !== "custom";
  const includeGlobal = isAll || selection.includeGlobal !== false;
  const includeProject = !opts.isSystemMain && (isAll || selection.includeProject !== false);
  const includeRuntime = !opts.isSystemMain && (isAll || selection.includeRuntime !== false);

  if (opts.isSystemMain || includeGlobal) {
    enabledLabels.push(`全局知识（${globalSources.length} 个来源）`);
  } else if (!opts.isSystemMain) {
    disabledLabels.push("全局知识（只读参考）");
  }

  for (const src of globalSources) {
    const label = `全局：${src.label}（${src.status}）`;
    const on = isAll || (selection.sourceIds?.includes(src.id) ?? false);
    if (on && (opts.isSystemMain || includeGlobal)) {
      enabledLabels.push(label);
      enabledSourceIds.push(src.id);
      globalSourceIds.push(src.id);
    } else {
      disabledLabels.push(label);
    }
  }

  if (!opts.isSystemMain && opts.projectId) {
    if (includeProject) {
      enabledLabels.push(`项目知识（${projectSources.length} 个来源）`);
    } else {
      disabledLabels.push("项目知识");
    }
    if (includeRuntime) {
      enabledLabels.push("项目运行记忆（自动）");
    } else {
      disabledLabels.push("项目运行记忆");
    }
    for (const src of projectSources) {
      const label = `项目：${src.label}（${src.status}）`;
      const on = isAll || (selection.sourceIds?.includes(src.id) ?? false);
      if (on && includeProject) {
        enabledLabels.push(label);
        enabledSourceIds.push(src.id);
        projectSourceIds.push(src.id);
      } else {
        disabledLabels.push(label);
      }
    }
  }

  return {
    summary: formatKnowledgeSelectionSummaryBlock({
      mode: isAll ? "all" : "custom",
      enabledLabels,
      disabledLabels,
    }),
    enabledSourceIds,
    includeGlobal: opts.isSystemMain ? true : includeGlobal,
    includeProject,
    includeRuntime,
    globalSourceIds,
    projectSourceIds,
  };
}
