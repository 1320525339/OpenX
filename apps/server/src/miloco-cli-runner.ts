import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const OPENX_ROOT = process.env.OPENX_ROOT ?? resolve(SERVER_DIR, "../../..");

/** 默认单命令超时（诊断路径） */
export const MILOCO_CLI_DEFAULT_TIMEOUT_MS = 10_000;

/** WSL bash / curl 探针默认超时 */
export const MILOCO_WSL_DEFAULT_TIMEOUT_MS = 10_000;

/** 全局 WSL/CLI 并发上限，避免诊断打满主进程 */
const MAX_CONCURRENT = Math.max(
  1,
  Number.parseInt(process.env.OPENX_MILOCO_CLI_CONCURRENCY ?? "3", 10) || 3,
);

export type MilocoCliRunResult = {
  ok: boolean;
  status: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
};

type QueueItem = {
  run: () => Promise<MilocoCliRunResult>;
  resolve: (value: MilocoCliRunResult) => void;
};

let activeCount = 0;
const waitQueue: QueueItem[] = [];

function pumpQueue(): void {
  while (activeCount < MAX_CONCURRENT && waitQueue.length > 0) {
    const item = waitQueue.shift()!;
    activeCount += 1;
    void item.run().then(
      (result) => {
        activeCount -= 1;
        item.resolve(result);
        pumpQueue();
      },
      (err: unknown) => {
        activeCount -= 1;
        item.resolve({
          ok: false,
          status: 1,
          stdout: "",
          stderr: err instanceof Error ? err.message : String(err),
        });
        pumpQueue();
      },
    );
  }
}

function withConcurrency(run: () => Promise<MilocoCliRunResult>): Promise<MilocoCliRunResult> {
  return new Promise((resolve) => {
    waitQueue.push({ run, resolve });
    pumpQueue();
  });
}

function killProcessTree(child: ChildProcess): void {
  if (child.killed) return;
  try {
    child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    if (!child.killed) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }, 1_500).unref?.();
}

function spawnWithTimeout(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<MilocoCliRunResult> {
  const { cwd, timeoutMs, env } = options;
  return new Promise((resolvePromise) => {
    let settled = false;
    let timedOut = false;
    let stdout = "";
    let stderr = "";

    const child = spawn(command, args, {
      cwd,
      env: env ?? process.env,
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });

    const finish = (result: MilocoCliRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };

    child.on("close", (code) => {
      if (timedOut) {
        finish({
          ok: false,
          status: code ?? 1,
          stdout: stdout.trim(),
          stderr: stderr.trim() || `命令超时（${timeoutMs}ms）`,
          timedOut: true,
        });
        return;
      }
      finish({
        ok: code === 0,
        status: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });

    child.on("error", (err) => {
      finish({
        ok: false,
        status: 1,
        stdout: stdout.trim(),
        stderr: err.message,
        timedOut,
      });
    });
  });
}

export type RunMilocoCliOptions = {
  timeoutMs?: number;
};

/** 异步执行 miloco-wsl.ps1（带超时与并发限制） */
export function runMilocoWslCliAsync(
  args: string[],
  options: RunMilocoCliOptions = {},
): Promise<MilocoCliRunResult> {
  const timeoutMs = options.timeoutMs ?? MILOCO_CLI_DEFAULT_TIMEOUT_MS;
  const scriptPath = resolve(OPENX_ROOT, "scripts/miloco-wsl.ps1");
  return withConcurrency(() =>
    spawnWithTimeout(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args],
      { cwd: OPENX_ROOT, timeoutMs },
    ),
  );
}

/**
 * 同步风格 API：内部仍走异步子进程（禁止 spawnSync 堵主线程）。
 * 调用方若在请求路径上应优先用 runMilocoWslCliAsync。
 */
export function runMilocoWslCli(
  args: string[],
  options: RunMilocoCliOptions = {},
): Promise<MilocoCliRunResult> {
  return runMilocoWslCliAsync(args, options);
}

/** 在 WSL 发行版内执行 bash -lc（异步 + 超时） */
export function runWslBashAsync(
  command: string,
  options: RunMilocoCliOptions = {},
): Promise<MilocoCliRunResult> {
  const timeoutMs = options.timeoutMs ?? MILOCO_WSL_DEFAULT_TIMEOUT_MS;
  const distro = process.env.OPENX_MILOCO_WSL_DISTRO ?? "Ubuntu";
  return withConcurrency(() =>
    spawnWithTimeout("wsl", ["-d", distro, "bash", "-lc", command], {
      timeoutMs,
    }),
  );
}

/** 测试用：重置并发队列状态 */
export function resetMilocoCliConcurrencyForTests(): void {
  waitQueue.length = 0;
  activeCount = 0;
}

/** 从 miloco-wsl 输出中提取 JSON（忽略 WSL stderr 噪声） */
export function parseMilocoCliJson<T = unknown>(stdout: string): T | null {
  const start = stdout.indexOf("{");
  const arrayStart = stdout.indexOf("[");
  let jsonStart = -1;
  if (start >= 0 && (arrayStart < 0 || start < arrayStart)) jsonStart = start;
  else if (arrayStart >= 0) jsonStart = arrayStart;
  if (jsonStart < 0) return null;
  try {
    return JSON.parse(stdout.slice(jsonStart)) as T;
  } catch {
    return null;
  }
}
