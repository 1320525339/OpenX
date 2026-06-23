import type { Settings } from "@openx/shared";
import type { SettingsResponse } from "../api";

/** 比较设置草稿与已保存版本（忽略服务端附加的解析路径字段） */
export function settingsDraftDirty(
  saved: SettingsResponse | null,
  draft: Settings | null,
): boolean {
  if (!saved || !draft) return false;
  return JSON.stringify(stripSettingsCompareNoise(draft)) !== JSON.stringify(stripSettingsCompareNoise(saved));
}

function stripSettingsCompareNoise(settings: Settings | SettingsResponse): Settings {
  const {
    workspaceResolved: _wr,
    systemWorkspaceResolved: _swr,
    ...rest
  } = settings as SettingsResponse;
  return rest;
}

/** 渠道/API 保存后合并服务端配置，保留设置面板中尚未落盘的标量字段 */
export function mergeServerSettingsIntoDraft(local: Settings, server: Settings): Settings {
  return {
    ...server,
    operatorTier: local.operatorTier,
    notifyOnComplete: local.notifyOnComplete,
    autoExecute: local.autoExecute,
    autoBootstrapConnect: local.autoBootstrapConnect,
    defaultExecutorId: local.defaultExecutorId,
    defaultConstraints: local.defaultConstraints,
    llmContext: local.llmContext,
    systemWorkspaceRoot: local.systemWorkspaceRoot,
    workspaceRoot: local.workspaceRoot,
  };
}
