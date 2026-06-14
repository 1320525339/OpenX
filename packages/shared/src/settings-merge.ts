import { isDefaultZenModelSection } from "./model-config.js";
import type { McpServerConfig } from "./mcp.js";
import type { Settings } from "./settings.js";

function mergeMcpServers(
  current: McpServerConfig[],
  incoming: McpServerConfig[],
): McpServerConfig[] {
  const map = new Map(current.map((s) => [s.id, s]));
  for (const server of incoming) {
    const prev = map.get(server.id);
    map.set(server.id, prev ? { ...prev, ...server } : server);
  }
  return Array.from(map.values());
}

/**
 * 将部分设置合并进当前配置（按 slug/id 合并，避免整包 PUT 抹掉并发写入的渠道）。
 * 参考 mimo2codex：providers 分文件维护，更新时 merge 而非 replace。
 */
export function mergeSettingsPatch(current: Settings, patch: Partial<Settings>): Settings {
  const {
    providers: patchProviders,
    model: patchModel,
    acpCli: patchAcpCli,
    skillBindings: patchSkillBindings,
    mcpServers: patchMcpServers,
    executors: patchExecutors,
    cliProfiles: patchCliProfiles,
    defaultConstraints: patchConstraints,
    ...scalarPatch
  } = patch;

  const next: Settings = {
    ...current,
    ...scalarPatch,
    model: patchModel ? { ...current.model, ...patchModel } : current.model,
    providers: patchProviders
      ? { ...(current.providers ?? {}), ...patchProviders }
      : current.providers,
    acpCli: patchAcpCli ? { ...(current.acpCli ?? {}), ...patchAcpCli } : current.acpCli,
    skillBindings: patchSkillBindings
      ? { ...(current.skillBindings ?? {}), ...patchSkillBindings }
      : current.skillBindings,
    mcpServers: patchMcpServers
      ? mergeMcpServers(current.mcpServers ?? [], patchMcpServers)
      : current.mcpServers,
    executors: patchExecutors
      ? {
          ...current.executors,
          ...patchExecutors,
          pi: patchExecutors.pi
            ? { ...current.executors?.pi, ...patchExecutors.pi }
            : current.executors?.pi,
        }
      : current.executors,
    cliProfiles: patchCliProfiles ?? current.cliProfiles,
    defaultConstraints: patchConstraints ?? current.defaultConstraints,
  };

  return next;
}

/**
 * 保存设置：以服务端 fresh 为底，合并本地修改。
 * 若本地仍是出厂 zen/big-pickle 占位而服务端已配置其他模型，保留服务端 model。
 */
export function mergeSettingsForSave(fresh: Settings, local: Settings): Settings {
  const localIsBootPlaceholder = isDefaultZenModelSection(local.model);
  const serverHasCustomModel = !isDefaultZenModelSection(fresh.model);
  if (localIsBootPlaceholder && serverHasCustomModel) {
    return mergeSettingsPatch(fresh, { ...local, model: fresh.model });
  }
  return mergeSettingsPatch(fresh, local);
}
