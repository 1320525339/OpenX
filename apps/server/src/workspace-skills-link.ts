import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { getOpenxSkillsDir } from "@openx/shared/skills-path";
import { resolveWorkspaceRoot } from "./workspace-path.js";

export type WorkspaceSkillsLinkStatus = {
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

/** 在工作区创建 `.openx/skills` → `~/.openx/skills` 目录链接 */
export function ensureWorkspaceSkillsLink(workspaceRoot: string): WorkspaceSkillsLinkStatus {
  const resolvedRoot = resolveWorkspaceRoot(workspaceRoot);
  const targetPath = getOpenxSkillsDir();
  const openxDir = join(resolvedRoot, ".openx");
  const linkPath = join(openxDir, "skills");

  const status: WorkspaceSkillsLinkStatus = {
    workspaceRoot: resolvedRoot,
    linkPath,
    targetPath,
    linked: false,
  };

  if (!existsSync(targetPath)) {
    status.error = "全局 Skills 目录尚未安装，请先同步 Obscura Skills";
    return status;
  }

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

export function getWorkspaceSkillsLinkStatus(workspaceRoot: string): WorkspaceSkillsLinkStatus {
  const resolvedRoot = resolveWorkspaceRoot(workspaceRoot);
  const targetPath = getOpenxSkillsDir();
  const linkPath = join(resolvedRoot, ".openx", "skills");

  const status: WorkspaceSkillsLinkStatus = {
    workspaceRoot: resolvedRoot,
    linkPath,
    targetPath,
    linked: false,
  };

  if (!existsSync(targetPath)) {
    status.error = "全局 Skills 目录尚未安装";
    return status;
  }

  const existingTarget = resolveLinkTarget(linkPath);
  if (existingTarget && samePath(existingTarget, targetPath)) {
    status.linked = true;
  } else if (existsSync(linkPath)) {
    status.error = "工作区链接存在但指向错误路径";
  }

  return status;
}
