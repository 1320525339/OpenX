import type { McpServerConfig } from "./mcp.js";

/** 内置 OpenX API MCP Server 的 settings.mcpServers.id */
export const OPENX_MCP_ID = "openx";

export const OPENX_MCP_DEFAULT_BASE = "http://127.0.0.1:3921";

/** 构建 OpenX 自举 MCP Server 配置（由服务端解析脚本路径后写入 settings） */
export function buildOpenxMcpServerConfig(
  scriptPath: string,
  opts?: { nodePath?: string; baseUrl?: string },
): McpServerConfig {
  const node = opts?.nodePath ?? "node";
  const baseUrl = opts?.baseUrl ?? OPENX_MCP_DEFAULT_BASE;
  return {
    id: OPENX_MCP_ID,
    name: "OpenX API",
    command: node,
    args: [scriptPath],
    env: {
      OPENX_API_BASE: baseUrl,
    },
    enabled: true,
  };
}

/** 合并/刷新内置 OpenX MCP（校正 node 路径与脚本路径） */
export function ensureOpenxMcpServer(
  servers: McpServerConfig[],
  scriptPath: string,
  opts?: { nodePath?: string; baseUrl?: string },
): McpServerConfig[] {
  const fresh = buildOpenxMcpServerConfig(scriptPath, opts);
  const idx = servers.findIndex((s) => s.id === OPENX_MCP_ID);
  if (idx < 0) return [fresh, ...servers];
  const cur = servers[idx]!;
  const same =
    cur.command === fresh.command &&
    cur.args.join("\0") === fresh.args.join("\0") &&
    cur.enabled === fresh.enabled &&
    JSON.stringify(cur.env ?? {}) === JSON.stringify(fresh.env ?? {});
  if (same) return servers;
  const next = [...servers];
  next[idx] = { ...fresh, name: cur.name || fresh.name };
  return next;
}
