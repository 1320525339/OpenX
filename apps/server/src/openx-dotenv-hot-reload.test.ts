import { mkdtempSync, writeFileSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadOpenxDotEnv,
  invalidateOpenxDotEnvCache,
  syncOpenxDotEnv,
  upsertOpenxDotEnv,
  readOpenxDotEnvVars,
} from "./openx-dotenv.js";
import { getSecretStore, resetSecretStore } from "./secrets-store.js";

describe("openx dotenv / secrets hot reload", () => {
  const prevHome = process.env.OPENX_HOME;
  const prevDotEnv = process.env.OPENX_DOTENV_PATH;
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "openx-dotenv-"));
    process.env.OPENX_HOME = home;
    process.env.OPENX_DOTENV_PATH = join(home, ".env");
    invalidateOpenxDotEnvCache();
    resetSecretStore();
    delete process.env.MIMO_API_KEY;
    delete process.env.TEST_HOT_KEY;
  });

  afterEach(() => {
    delete process.env.MIMO_API_KEY;
    delete process.env.TEST_HOT_KEY;
    if (prevHome === undefined) delete process.env.OPENX_HOME;
    else process.env.OPENX_HOME = prevHome;
    if (prevDotEnv === undefined) delete process.env.OPENX_DOTENV_PATH;
    else process.env.OPENX_DOTENV_PATH = prevDotEnv;
    invalidateOpenxDotEnvCache();
    resetSecretStore();
  });

  it("loadOpenxDotEnv overrides ambient env with ~/.openx/.env", () => {
    process.env.MIMO_API_KEY = "stale-from-shell";
    writeFileSync(join(home, ".env"), "MIMO_API_KEY=fresh-from-openx\n", "utf8");

    const applied = loadOpenxDotEnv();
    expect(applied).toContain("MIMO_API_KEY");
    expect(process.env.MIMO_API_KEY).toBe("fresh-from-openx");
  });

  it("syncOpenxDotEnv picks up .env changes without process restart", () => {
    process.env.MIMO_API_KEY = "stale-from-shell";
    writeFileSync(join(home, ".env"), "MIMO_API_KEY=v1\n", "utf8");
    loadOpenxDotEnv();
    expect(process.env.MIMO_API_KEY).toBe("v1");

    writeFileSync(join(home, ".env"), "MIMO_API_KEY=v2-after-settings-save\n", "utf8");
    // 部分文件系统 mtime 精度较低，推进一点避免缓存误命中
    const path = join(home, ".env");
    const st = statSync(path);
    utimesSync(path, st.atime, new Date(st.mtimeMs + 20));

    const applied = syncOpenxDotEnv();
    expect(applied).toContain("MIMO_API_KEY");
    expect(process.env.MIMO_API_KEY).toBe("v2-after-settings-save");
  });

  it("readOpenxDotEnvVars caches by mtime", () => {
    writeFileSync(join(home, ".env"), "TEST_HOT_KEY=a\n", "utf8");
    expect(readOpenxDotEnvVars().TEST_HOT_KEY).toBe("a");
    // 不改 mtime 时即便文件内容被“同内容”再次读取也应稳定
    expect(readOpenxDotEnvVars().TEST_HOT_KEY).toBe("a");
  });

  it("FileSecretStore prefers .env over ambient process.env", () => {
    process.env.TEST_HOT_KEY = "ambient-stale";
    upsertOpenxDotEnv({ TEST_HOT_KEY: "file-fresh" });
    // 模拟未走 upsert 的 process.env 回退到旧值
    process.env.TEST_HOT_KEY = "ambient-stale";

    expect(getSecretStore().get("TEST_HOT_KEY")).toBe("file-fresh");
  });
});
