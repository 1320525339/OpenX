import path from "node:path";
import type { Settings } from "@openx/shared";

/** 将 settings.workspaceRoot 解析为绝对路径 */
export function resolveWorkspaceRoot(workspaceRoot: string): string {
  const root = workspaceRoot?.trim() || ".";
  if (root === ".") return process.cwd();
  return path.isAbsolute(root) ? path.normalize(root) : path.resolve(process.cwd(), root);
}

/** 持久化前将工作目录规范为绝对路径，避免配置值与展示/执行路径不一致 */
export function normalizeWorkspaceRootForStorage(workspaceRoot: string): string {
  return resolveWorkspaceRoot(workspaceRoot);
}

export type SettingsWithWorkspaceResolved = Settings & {
  workspaceResolved: string;
};

export function withWorkspaceResolved(settings: Settings): SettingsWithWorkspaceResolved {
  return {
    ...settings,
    workspaceResolved: resolveWorkspaceRoot(settings.workspaceRoot),
  };
}
