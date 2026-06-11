import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WINDOWS_NODE = "C:\\Program Files\\nodejs\\node.exe";

/** MCP 子进程优先用系统 Node，避免 Cursor 内置 node 无法 spawn */
export function resolveNodeForMcp(): string {
  const override = process.env.OPENX_NODE_PATH?.trim();
  if (override && existsSync(override)) return override;
  if (process.platform === "win32" && existsSync(WINDOWS_NODE)) return WINDOWS_NODE;
  return process.execPath;
}

/** 解析 @openx/mcp-openx 编译产物路径（供 settings 自举 MCP 配置） */
export function resolveMcpOpenxScript(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "../../../packages/mcp-openx/dist/index.js"),
    join(here, "../../../../packages/mcp-openx/dist/index.js"),
    join(process.cwd(), "packages/mcp-openx/dist/index.js"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error("未找到 @openx/mcp-openx，请先执行 pnpm --filter @openx/mcp-openx build");
}
