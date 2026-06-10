import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { resolveWorkspaceRoot } from "./workspace-path.js";

export type PathKind = "file" | "directory";

export function normalizeOpenPathInput(input: string): string {
  let p = input.trim();
  if (p.startsWith("`") && p.endsWith("`")) {
    p = p.slice(1, -1).trim();
  }
  if (p.startsWith("~/")) {
    return path.join(homedir(), p.slice(2));
  }
  return p;
}

export function resolveOpenPath(input: string, workspaceRoot: string): string {
  const p = normalizeOpenPathInput(input);
  if (path.isAbsolute(p)) return path.normalize(p);
  return path.resolve(resolveWorkspaceRoot(workspaceRoot), p);
}

/** 根据磁盘类型判断；不存在时按路径形态推断 */
export function classifyPath(absPath: string): PathKind {
  try {
    if (existsSync(absPath)) {
      return statSync(absPath).isDirectory() ? "directory" : "file";
    }
  } catch {
    /* ignore */
  }
  if (/[\\/]$/.test(absPath)) return "directory";
  return path.extname(absPath) ? "file" : "directory";
}

/** cursor://file/C:/path — 仅文件；文件夹不走 IDE 协议 */
export function buildIdeOpenUrl(
  absPath: string,
  kind: PathKind,
  line?: number,
): string | null {
  if (kind === "directory") return null;
  const file = absPath.replace(/\\/g, "/");
  const suffix = line && line > 0 ? `:${line}` : "";
  return `cursor://file/${file}${suffix}`;
}

function trySpawn(
  command: string,
  args: string[],
  opts?: { shell?: boolean },
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      shell: opts?.shell ?? process.platform === "win32",
    });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}

const CLI_CANDIDATES = ["cursor", "code"] as const;

const IDE_FILE_RE =
  /\.(tsx?|jsx?|mjs|cjs|json|md|mdx|css|scss|less|html|vue|svelte|py|go|rs|java|kt|cs|cpp|c|h|hpp|yaml|yml|toml|env|sh|ps1|sql|rb|php|swift|zig|lua|dockerfile|gitignore|gitattributes)$/i;

function shouldOpenInIde(absPath: string): boolean {
  const base = path.basename(absPath);
  if (base === "Dockerfile" || base.startsWith(".")) return true;
  const ext = path.extname(absPath);
  if (!ext) return true;
  return IDE_FILE_RE.test(ext);
}

async function openWithDefaultApp(absPath: string): Promise<boolean> {
  if (process.platform === "win32") {
    return trySpawn("cmd.exe", ["/c", "start", "", absPath]);
  }
  if (process.platform === "darwin") {
    return trySpawn("open", [absPath]);
  }
  return trySpawn("xdg-open", [absPath]);
}

async function openFolderInFileManager(absPath: string): Promise<boolean> {
  const normalized = path.normalize(absPath);
  if (process.platform === "win32") {
    return trySpawn("explorer.exe", [normalized], { shell: false });
  }
  if (process.platform === "darwin") {
    return trySpawn("open", [normalized], { shell: false });
  }
  return trySpawn("xdg-open", [normalized], { shell: false });
}

async function openFileInIde(absPath: string): Promise<{ ok: boolean; command?: string }> {
  for (const cli of CLI_CANDIDATES) {
    const ok = await trySpawn(cli, ["-g", absPath]);
    if (ok) return { ok: true, command: cli };
  }
  return { ok: false };
}

export async function openPathInIde(absPath: string): Promise<{
  ok: boolean;
  command?: string;
  exists: boolean;
  kind: PathKind;
  method?: "ide" | "default-app" | "file-manager";
}> {
  const kind = classifyPath(absPath);
  const exists = existsSync(absPath);

  if (kind === "file") {
    if (!exists) {
      return { ok: false, exists: false, kind };
    }
    if (shouldOpenInIde(absPath)) {
      const ide = await openFileInIde(absPath);
      if (ide.ok) {
        return { ok: true, command: ide.command, exists: true, kind, method: "ide" };
      }
    }
    const opened = await openWithDefaultApp(absPath);
    if (opened) {
      return { ok: true, command: "default-app", exists: true, kind, method: "default-app" };
    }
    const ide = await openFileInIde(absPath);
    if (ide.ok) {
      return { ok: true, command: ide.command, exists: true, kind, method: "ide" };
    }
    return { ok: false, exists: true, kind };
  }

  // 目录：仅用系统文件管理器打开，不经过 Cursor / VS Code
  if (!exists) {
    return { ok: false, exists: false, kind };
  }
  const opened = await openFolderInFileManager(absPath);
  if (opened) {
    return { ok: true, command: "file-manager", exists: true, kind, method: "file-manager" };
  }
  return { ok: false, exists: true, kind };
}

/** @deprecated 使用 buildIdeOpenUrl */
export function buildIdeFileUrl(absPath: string, line?: number): string | null {
  return buildIdeOpenUrl(absPath, classifyPath(absPath), line);
}
