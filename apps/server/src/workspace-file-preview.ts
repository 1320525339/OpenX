import { existsSync, readFileSync, statSync } from "node:fs";
import { languageFromPath } from "@openx/shared";
import { resolveOpenPath } from "./ide-open.js";

const MAX_BYTES = 32_000;

export function readWorkspaceFilePreview(inputPath: string, workspaceRoot: string) {
  const absolutePath = resolveOpenPath(inputPath, workspaceRoot);
  if (!existsSync(absolutePath)) {
    return {
      ok: false as const,
      path: inputPath,
      absolutePath,
      exists: false,
    };
  }
  const stat = statSync(absolutePath);
  if (!stat.isFile()) {
    return {
      ok: false as const,
      path: inputPath,
      absolutePath,
      exists: true,
      error: "not_a_file",
    };
  }
  const buf = readFileSync(absolutePath);
  const truncated = buf.byteLength > MAX_BYTES;
  const slice = truncated ? buf.subarray(0, MAX_BYTES) : buf;
  return {
    ok: true as const,
    path: inputPath,
    absolutePath,
    exists: true,
    content: slice.toString("utf8"),
    truncated,
    language: languageFromPath(absolutePath),
    size: stat.size,
  };
}
