import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  clearMemoryIndex,
  indexMemoryChunk,
  searchMemoryFts,
  type MemorySearchHit,
} from "./db.js";

const MEMORY_ROOT = ".openx/memory";

export function projectMemoryFile(
  workspaceRoot: string,
  projectId: string,
): string {
  return join(workspaceRoot, MEMORY_ROOT, "projects", projectId, "MEMORY.md");
}

export function globalMemoryFile(workspaceRoot: string): string {
  return join(workspaceRoot, MEMORY_ROOT, "global", "MEMORY.md");
}

export function readProjectMemory(
  workspaceRoot: string,
  projectId: string,
): string | undefined {
  const path = projectMemoryFile(workspaceRoot, projectId);
  if (!existsSync(path)) return undefined;
  try {
    return readFileSync(path, "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
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

export function syncProjectMemoryIndex(
  projectId: string,
  content: string,
  scope = "project",
): void {
  clearMemoryIndex(projectId, scope);
  const trimmed = content.trim();
  if (!trimmed) return;
  for (const section of splitMemorySections(trimmed)) {
    const chunk = `## ${section.heading}\n${section.body}`.trim();
    if (chunk) indexMemoryChunk(projectId, scope, chunk);
  }
}

export function appendProjectMemorySection(
  workspaceRoot: string,
  projectId: string,
  heading: string,
  body: string,
): string {
  const path = projectMemoryFile(workspaceRoot, projectId);
  mkdirSync(dirname(path), { recursive: true });
  const existing = readProjectMemory(workspaceRoot, projectId);
  const block = `## ${heading}\n${body.trim()}\n`;
  const next = existing ? `${existing.trim()}\n\n${block}` : `${block}`;
  writeFileSync(path, `${next.trim()}\n`, "utf8");
  syncProjectMemoryIndex(projectId, next);
  return next;
}

export function searchProjectMemory(
  projectId: string,
  query: string,
  limit = 5,
): MemorySearchHit[] {
  return searchMemoryFts(projectId, query, limit);
}

export function formatMemoryHitsForCoach(hits: MemorySearchHit[]): string | undefined {
  if (hits.length === 0) return undefined;
  return hits
    .map((hit, index) => `### 记忆 ${index + 1}\n${hit.content.trim()}`)
    .join("\n\n");
}

export function loadProjectMemoryContext(
  workspaceRoot: string,
  projectId: string,
  query?: string,
): string | undefined {
  if (query?.trim()) {
    const hits = searchProjectMemory(projectId, query, 4);
    const formatted = formatMemoryHitsForCoach(hits);
    if (formatted) return `## 项目记忆（检索命中）\n${formatted}`;
  }
  const memory = readProjectMemory(workspaceRoot, projectId);
  if (!memory) return undefined;
  const clipped =
    memory.length > 2400 ? `${memory.slice(0, 2400)}\n…（MEMORY.md 已截断）` : memory;
  return `## 项目记忆（MEMORY.md）\n${clipped}`;
}
