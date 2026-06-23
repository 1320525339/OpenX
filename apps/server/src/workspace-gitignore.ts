import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const OPENX_GITIGNORE_MARKER = "# OpenX runtime knowledge";
export const OPENX_GITIGNORE_LINE = ".openx/";

/** 确保 workspace 根目录 .gitignore 忽略 .openx/ 运行知识（幂等） */
export function ensureWorkspaceOpenxGitignore(workspaceRoot: string): boolean {
  const path = join(workspaceRoot, ".gitignore");
  if (existsSync(path)) {
    const content = readFileSync(path, "utf8");
    if (content.includes(OPENX_GITIGNORE_LINE) || /\n\.openx\b/m.test(content)) {
      return false;
    }
    appendFileSync(path, `\n${OPENX_GITIGNORE_MARKER}\n${OPENX_GITIGNORE_LINE}\n`, "utf8");
    return true;
  }
  writeFileSync(path, `${OPENX_GITIGNORE_MARKER}\n${OPENX_GITIGNORE_LINE}\n`, "utf8");
  return true;
}
