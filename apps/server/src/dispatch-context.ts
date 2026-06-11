import {
  COACH_MCP_CATALOG,
  toAcpMcpServerEntry,
  type McpServerConfig,
  type Settings,
} from "@openx/shared";
import { resolveCoachAgent } from "./agents-service.js";

/** 解析派单时传给 ACP 的 MCP servers（settings 中 enabled 且可选按 id 过滤） */
export function resolveDispatchMcpServers(
  settings: Settings,
  selectedMcpIds?: string[],
): ReturnType<typeof toAcpMcpServerEntry>[] {
  const servers = settings.mcpServers ?? [];
  const enabled = servers.filter((s) => s.enabled);
  if (!selectedMcpIds?.length) {
    return enabled.map(toAcpMcpServerEntry);
  }
  const idSet = new Set(selectedMcpIds);
  return enabled.filter((s) => idSet.has(s.id)).map(toAcpMcpServerEntry);
}

/** 从 settings + agentId 解析执行 Agent 角色 prompt（含全局约束附加） */
export function resolveDispatchAgentRole(
  settings: Settings,
  agentId?: string,
): string | undefined {
  const parts: string[] = [];
  const fromAgent = resolveCoachAgent(agentId).rolePrompt?.trim();
  if (fromAgent) parts.push(fromAgent);
  if (settings.defaultConstraints?.length) {
    parts.push(
      `【全局约束】\n${settings.defaultConstraints.map((c) => `- ${c}`).join("\n")}`,
    );
  }
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

/** MCP 目录：settings 配置 + 内置 catalog 合并（供 Web 展示） */
export function listMcpCatalog(settings: Settings): Array<{
  id: string;
  name: string;
  desc: string;
  configured: boolean;
  config?: McpServerConfig;
}> {
  const configured = new Map((settings.mcpServers ?? []).map((s) => [s.id, s]));
  const ids = new Set<string>();
  const out: Array<{
    id: string;
    name: string;
    desc: string;
    configured: boolean;
    config?: McpServerConfig;
  }> = [];

  for (const item of COACH_MCP_CATALOG) {
    ids.add(item.id);
    const cfg = configured.get(item.id);
    out.push({
      id: item.id,
      name: cfg?.name ?? item.name,
      desc: item.desc,
      configured: Boolean(cfg),
      config: cfg,
    });
  }

  for (const cfg of settings.mcpServers ?? []) {
    if (ids.has(cfg.id)) continue;
    out.push({
      id: cfg.id,
      name: cfg.name,
      desc: cfg.command,
      configured: true,
      config: cfg,
    });
  }

  return out;
}
