import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const MAX_BASELINE_BYTES = 48_000;

export function resolveWorkspaceFilePath(
  workspaceRoot: string,
  filePath: string,
): string | undefined {
  const root = path.resolve(workspaceRoot);
  const normalized = filePath.trim();
  if (!normalized) return undefined;
  const abs = path.isAbsolute(normalized)
    ? path.normalize(normalized)
    : path.resolve(root, normalized);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
  return abs;
}

/** 工具执行前读取文件基线（用于 diff before） */
export function readWorkspaceFileBaseline(
  workspaceRoot: string,
  filePath: string,
): string | undefined {
  try {
    const abs = resolveWorkspaceFilePath(workspaceRoot, filePath);
    if (!abs || !existsSync(abs)) return undefined;
    const stat = statSync(abs);
    if (!stat.isFile()) return undefined;
    const buf = readFileSync(abs);
    const clipped = buf.byteLength > MAX_BASELINE_BYTES;
    const slice = clipped ? buf.subarray(0, MAX_BASELINE_BYTES) : buf;
    const text = slice.toString("utf8");
    return clipped ? `${text}\n…` : text;
  } catch {
    return undefined;
  }
}
