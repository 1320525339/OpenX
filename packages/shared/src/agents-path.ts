import { homedir } from "node:os";
import { join } from "node:path";

/** OpenX 本地 Agent 定义目录（浏览器请用 API 返回的 agentsDir） */
export function getOpenxAgentsDir(): string {
  const override = process.env.OPENX_AGENTS_DIR?.trim();
  if (override) return override;
  return join(homedir(), ".openx", "agents");
}
