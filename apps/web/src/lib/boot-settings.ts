import { DEFAULT_SETTINGS } from "@openx/shared";
import type { SettingsResponse } from "../api";

/** 配置未拉取完成前的占位，避免整页阻塞在「加载中」 */
export function resolveBootSettings(
  settings: SettingsResponse | null,
): SettingsResponse {
  if (settings) return settings;
  return {
    ...DEFAULT_SETTINGS,
    workspaceResolved: "",
    systemWorkspaceResolved: "",
  };
}
