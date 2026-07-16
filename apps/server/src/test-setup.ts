import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 每个 vitest worker 隔离 OPENX_HOME，避免写入用户 ~/.openx 与 Zvec LOCK 冲突。
 * 单测若已显式设置 OPENX_* 路径则尊重之。
 */
const workerId =
  process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID ?? String(process.pid);

if (!process.env.OPENX_HOME?.trim()) {
  process.env.OPENX_HOME = mkdtempSync(join(tmpdir(), `openx-vitest-${workerId}-`));
}

const home = process.env.OPENX_HOME;
if (!process.env.OPENX_DB_PATH) {
  process.env.OPENX_DB_PATH = ":memory:";
}
if (!process.env.OPENX_CONFIG_PATH) {
  process.env.OPENX_CONFIG_PATH = join(home, "config.json");
}
if (!process.env.OPENX_PROVIDERS_PATH) {
  process.env.OPENX_PROVIDERS_PATH = join(home, "providers.json");
}
if (!process.env.OPENX_DOTENV_PATH) {
  process.env.OPENX_DOTENV_PATH = join(home, ".env");
}
if (process.env.OPENX_ZVEC_ENABLED === undefined) {
  process.env.OPENX_ZVEC_ENABLED = "0";
}
