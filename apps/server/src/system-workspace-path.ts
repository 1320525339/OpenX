import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Settings } from "@openx/shared";
import { OPENX_MCP_ID, SYSTEM_PROJECT_ID } from "@openx/shared";
import { OPENX_DIR } from "./paths.js";
import { normalizeWorkspaceRootForStorage } from "./workspace-path.js";
import { ensureWorkspaceSkillsLink } from "./workspace-skills-link.js";
import { ensureWorkspaceAgentsLink } from "./workspace-agents-link.js";
import { syncWorkspaceMcpJson } from "./workspace-mcp-json.js";
import { getProjectById, updateProject } from "./db.js";

/** 默认系统工程目录：~/.openx/workspace */
export function defaultSystemWorkspacePath(): string {
  return join(OPENX_DIR, "workspace");
}

/** 解析系统工程工作目录（调度台、系统任务、Skills/MCP 链接） */
export function resolveSystemWorkspaceRoot(settings: Settings): string {
  const configured = settings.systemWorkspaceRoot?.trim();
  if (configured && configured !== ".") {
    return normalizeWorkspaceRootForStorage(configured);
  }
  const legacy = settings.workspaceRoot?.trim();
  if (legacy && legacy !== ".") {
    return normalizeWorkspaceRootForStorage(legacy);
  }
  return defaultSystemWorkspacePath();
}

export function ensureSystemWorkspaceDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/** 同步系统工作区：创建目录、Skills 链接、MCP 配置、更新 openx-system 项目 */
export function syncSystemWorkspaceLayout(settings: Settings): string {
  const dir = resolveSystemWorkspaceRoot(settings);
  ensureSystemWorkspaceDir(dir);
  ensureWorkspaceSkillsLink(dir);
  ensureWorkspaceAgentsLink(dir);
  syncWorkspaceMcpJson(
    dir,
    settings.mcpServers?.find((s) => s.id === OPENX_MCP_ID),
  );
  const project = getProjectById(SYSTEM_PROJECT_ID);
  if (project && project.workspaceDir !== dir) {
    project.workspaceDir = dir;
    updateProject(project);
  }
  return dir;
}
