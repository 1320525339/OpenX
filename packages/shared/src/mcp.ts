import { z } from "zod";

/** MCP Server 配置（派单时传给 ACP 施工队） */
export const McpServerConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** 启动命令，如 npx */
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).optional(),
  /** 是否默认启用 */
  enabled: z.boolean().default(true),
});
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const McpServersSchema = z.array(McpServerConfigSchema).default([]);
export type McpServers = z.infer<typeof McpServersSchema>;

/** 转为 ACP 协议 mcpServers 条目（stdio；env 为 ACP 要求的 name/value 数组） */
export function toAcpMcpServerEntry(
  config: McpServerConfig,
): {
  name: string;
  command: string;
  args: string[];
  env: Array<{ name: string; value: string }>;
} {
  const env = config.env
    ? Object.entries(config.env).map(([name, value]) => ({ name, value }))
    : [];
  // ACP / Claude Code WaitForMcpServers 按 id 匹配（如 openx）
  return {
    name: config.id,
    command: config.command,
    args: config.args,
    env,
  };
}
