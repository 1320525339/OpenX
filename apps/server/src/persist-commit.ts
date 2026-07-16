import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getOpenxHome } from "./paths.js";
import { atomicWriteJson } from "./atomic-json.js";

/** 写入跨文件提交标记，便于启动对账 */
export function writePersistCommitMarker(revision: number): void {
  atomicWriteJson(join(getOpenxHome(), "persist-commit.json"), {
    revision,
    committedAt: new Date().toISOString(),
    config: "config.json",
    providers: "providers.json",
  });
}

export function readPersistCommitMarker(): { revision: number } | null {
  const path = join(getOpenxHome(), "persist-commit.json");
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { revision?: number };
    if (typeof parsed.revision === "number") return { revision: parsed.revision };
  } catch {
    /* ignore */
  }
  return null;
}
