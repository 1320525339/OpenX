/**
 * OpenX 自举 E2E：自启 server + POST /api/operator/self-test
 *
 * 用法：pnpm e2e:self
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PORT = 3923;
const BASE = `http://127.0.0.1:${PORT}`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHttp(path = "/api/health") {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}${path}`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await sleep(500);
  }
  throw new Error(`服务未就绪: ${BASE}`);
}

function startServer() {
  return spawn("npx", ["tsx", "src/index.ts"], {
    cwd: join(ROOT, "apps/server"),
    env: {
      ...process.env,
      PORT: String(PORT),
      OPENX_DB_PATH: ":memory:",
      OPENX_MOCK_PI: "1",
    },
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function json(path, init) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${path} → ${res.status}: ${body.error ?? res.statusText}`);
  }
  return body;
}

async function main() {
  console.log("\n=== OpenX E2E: Operator Self-Test ===\n");

  console.log("[1] 构建 connect-client + mcp-openx…");
  await new Promise((resolve, reject) => {
    const proc = spawn(
      "pnpm",
      ["--filter", "@openx/connect-client", "--filter", "@openx/mcp-openx", "run", "build"],
      { cwd: ROOT, shell: true, stdio: "inherit" },
    );
    proc.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`build exit ${code}`))));
  });

  console.log("[2] 启动 server (MOCK_PI, :memory:)…");
  const server = startServer();
  server.stdout?.on("data", (d) => process.stdout.write(d));
  server.stderr?.on("data", (d) => process.stderr.write(d));

  let exitCode = 1;
  try {
    await waitForHttp();

    console.log("[3] 设置 operatorTier=operator…");
    const settings = await json("/api/settings");
    await json("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ ...settings, operatorTier: "operator" }),
    });

    console.log("[4] 运行 POST /api/operator/self-test…");
    const result = await json("/api/operator/self-test", {
      method: "POST",
      body: JSON.stringify({ skipConnect: true }),
    });

    for (const step of result.steps ?? []) {
      const mark = step.ok ? "✓" : "✗";
      console.log(`  ${mark} ${step.id}: ${step.detail}`);
    }

    if (!result.ok) {
      throw new Error("self-test 存在失败步骤");
    }

    console.log("\n[5] 全部通过\n");
    exitCode = 0;
  } finally {
    server.kill("SIGTERM");
    await sleep(500);
    process.exit(exitCode);
  }
}

main().catch((err) => {
  console.error("\n[e2e:self] 失败:", err.message);
  process.exit(1);
});
