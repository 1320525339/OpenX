import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServerConfig } from "@openx/shared";
import { OPENX_MCP_ID } from "@openx/shared";

type McpJsonFile = {
  mcpServers?: Record<
    string,
    {
      type?: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  >;
};

/** 将 openx MCP 写入工作区 .mcp.json，供 Claude Code (CC) 读取 */
export function syncWorkspaceMcpJson(
  workspaceRoot: string,
  openx: McpServerConfig | undefined,
): { path: string; written: boolean } {
  const mcpPath = join(workspaceRoot, ".mcp.json");
  if (!openx?.enabled) {
    return { path: mcpPath, written: false };
  }

  let existing: McpJsonFile = {};
  if (existsSync(mcpPath)) {
    try {
      existing = JSON.parse(readFileSync(mcpPath, "utf8")) as McpJsonFile;
    } catch {
      existing = {};
    }
  }

  const entry = {
    type: "stdio" as const,
    command: openx.command,
    args: openx.args ?? [],
    env: openx.env ?? {},
  };

  const prev = existing.mcpServers?.[OPENX_MCP_ID];
  const same =
    prev &&
    prev.command === entry.command &&
    JSON.stringify(prev.args ?? []) === JSON.stringify(entry.args) &&
    JSON.stringify(prev.env ?? {}) === JSON.stringify(entry.env);

  if (same) return { path: mcpPath, written: false };

  const next: McpJsonFile = {
    ...existing,
    mcpServers: {
      ...(existing.mcpServers ?? {}),
      [OPENX_MCP_ID]: entry,
    },
  };
  writeFileSync(mcpPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return { path: mcpPath, written: true };
}
