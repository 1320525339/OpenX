import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { ContextPack } from "@openx/shared";

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".openx",
  ".turbo",
  "coverage",
]);
const KEY_FILE_NAMES = ["README.md", "package.json", "pnpm-workspace.yaml", "tsconfig.json"];
const MAX_TREE_LINES = 80;
const MAX_KEY_FILE_CHARS = 900;
const CACHE_TTL_MS = 60_000;

const cache = new Map<string, { pack: ContextPack; at: number }>();

/** 是否应对当前消息收集项目上下文 */
export function shouldGatherProjectContext(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  return (
    /实现|修复|bug|代码|文件|目录|重构|添加|修改|开发|函数|组件|模块|api|接口|测试|配置|部署/i.test(
      m,
    ) ||
    /implement|fix|refactor|add|create|update|debug|test|config/i.test(m) ||
    /看.*(文件|目录)|列出|目录结构|workspace|read\s+file/i.test(m)
  );
}

function listTreeLines(root: string, dir: string, depth: number, lines: string[]): void {
  if (lines.length >= MAX_TREE_LINES || depth > 3) return;
  let entries: string[];
  try {
    entries = readdirSync(dir).sort();
  } catch {
    return;
  }
  for (const name of entries) {
    if (lines.length >= MAX_TREE_LINES) break;
    if (IGNORE_DIRS.has(name)) continue;
    const full = join(dir, name);
    let rel: string;
    try {
      rel = relative(root, full).replace(/\\/g, "/") || name;
    } catch {
      continue;
    }
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    const indent = "  ".repeat(depth);
    if (st.isDirectory()) {
      lines.push(`${indent}${rel}/`);
      listTreeLines(root, full, depth + 1, lines);
    } else {
      lines.push(`${indent}${rel}`);
    }
  }
}

function readKeyFileSummary(root: string, relPath: string): string | null {
  const full = join(root, relPath);
  if (!existsSync(full)) return null;
  try {
    const raw = readFileSync(full, "utf8");
    const trimmed = raw.trim().slice(0, MAX_KEY_FILE_CHARS);
    return trimmed + (raw.length > MAX_KEY_FILE_CHARS ? "\n…(截断)" : "");
  } catch {
    return null;
  }
}

/** 确定性收集项目上下文（带短缓存） */
export function gatherContextPack(workspaceRoot: string): ContextPack | null {
  if (!workspaceRoot || !existsSync(workspaceRoot)) return null;

  const cached = cache.get(workspaceRoot);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.pack;
  }

  const lines: string[] = [];
  listTreeLines(workspaceRoot, workspaceRoot, 0, lines);

  const keyFiles: ContextPack["keyFiles"] = [];
  for (const name of KEY_FILE_NAMES) {
    const summary = readKeyFileSummary(workspaceRoot, name);
    if (summary) keyFiles.push({ path: name, summary });
  }

  const pack: ContextPack = {
    root: workspaceRoot,
    fileTree: lines.length > 0 ? lines.join("\n") : "(空目录或无法读取)",
    keyFiles,
    generatedAt: new Date().toISOString(),
  };

  cache.set(workspaceRoot, { pack, at: Date.now() });
  return pack;
}

export function clearContextPackCache(): void {
  cache.clear();
}
