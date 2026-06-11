import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { getOpenxAgentsDir } from "@openx/shared/agents-path";
import { resolveWorkspaceRoot } from "./workspace-path.js";

export type WorkspaceAgentsLinkStatus = {
  workspaceRoot: string;
  linkPath: string;
  targetPath: string;
  linked: boolean;
  error?: string;
};

function samePath(a: string, b: string): boolean {
  try {
    return a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
  } catch {
    return a === b;
  }
}

function resolveLinkTarget(linkPath: string): string | null {
  try {
    if (!existsSync(linkPath)) return null;
    const stat = lstatSync(linkPath);
    if (!stat.isSymbolicLink()) return null;
    const target = readlinkSync(linkPath);
    return target.startsWith("\\\\?\\") ? target.slice(4) : target;
  } catch {
    return null;
  }
}

function removeLinkOrDir(linkPath: string): void {
  if (!existsSync(linkPath)) return;
  const stat = lstatSync(linkPath);
  if (stat.isSymbolicLink() || stat.isDirectory()) {
    rmSync(linkPath, { recursive: true, force: true });
    return;
  }
  rmSync(linkPath, { force: true });
}

/** 在工作区创建 `.openx/agents` → `~/.openx/agents` 目录链接 */
export function ensureWorkspaceAgentsLink(workspaceRoot: string): WorkspaceAgentsLinkStatus {
  const resolvedRoot = resolveWorkspaceRoot(workspaceRoot);
  const targetPath = getOpenxAgentsDir();
  const openxDir = join(resolvedRoot, ".openx");
  const linkPath = join(openxDir, "agents");

  const status: WorkspaceAgentsLinkStatus = {
    workspaceRoot: resolvedRoot,
    linkPath,
    targetPath,
    linked: false,
  };

  mkdirSync(targetPath, { recursive: true });

  try {
    const existingTarget = resolveLinkTarget(linkPath);
    if (existingTarget && samePath(existingTarget, targetPath)) {
      status.linked = true;
      return status;
    }

    if (existsSync(linkPath)) {
      removeLinkOrDir(linkPath);
    }

    mkdirSync(openxDir, { recursive: true });

    if (process.platform === "win32") {
      symlinkSync(targetPath, linkPath, "junction");
    } else {
      symlinkSync(targetPath, linkPath, "dir");
    }

    status.linked = true;
    return status;
  } catch (err) {
    status.error = err instanceof Error ? err.message : String(err);
    return status;
  }
}

export function getWorkspaceAgentsLinkStatus(workspaceRoot: string): WorkspaceAgentsLinkStatus {
  const resolvedRoot = resolveWorkspaceRoot(workspaceRoot);
  const targetPath = getOpenxAgentsDir();
  const linkPath = join(resolvedRoot, ".openx", "agents");

  const status: WorkspaceAgentsLinkStatus = {
    workspaceRoot: resolvedRoot,
    linkPath,
    targetPath,
    linked: false,
  };

  const existingTarget = resolveLinkTarget(linkPath);
  if (existingTarget && samePath(existingTarget, targetPath)) {
    status.linked = true;
  } else if (existsSync(linkPath)) {
    status.error = "工作区 Agent 链接存在但指向错误路径";
  }

  return status;
}
