import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildConnectBootstrapCommand, type CliProfile } from "@openx/shared";
import { getOpenxSkillsDir } from "@openx/shared/skills-path";

const bootstrapped = new Map<string, ChildProcess>();

function resolveConnectClientScript(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "../../../packages/connect-client/dist/cli.js"),
    join(here, "../../../../packages/connect-client/dist/cli.js"),
    join(process.cwd(), "packages/connect-client/dist/cli.js"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error("未找到 connect-client，请先执行 pnpm --filter @openx/connect-client build");
}

export function getBootstrapCommand(
  profile: CliProfile,
  baseUrl: string,
  projectRoot?: string,
): string {
  return buildConnectBootstrapCommand({
    executorId: profile.executorId,
    displayName: profile.displayName,
    toolName: profile.toolName,
    baseUrl,
    projectRoot,
    skillsDir: getOpenxSkillsDir(),
  });
}

export function bootstrapConnectProfile(
  profile: CliProfile,
  baseUrl: string,
): { command: string; pid?: number } {
  if (profile.kind !== "connect") {
    throw new Error("仅 Connect 类型 CLI 支持一键自举");
  }

  const existing = bootstrapped.get(profile.executorId);
  if (existing && existing.exitCode === null && !existing.killed) {
    return {
      command: getBootstrapCommand(profile, baseUrl),
      pid: existing.pid,
    };
  }

  const script = resolveConnectClientScript();
  const toolName = profile.toolName ?? profile.executorId;
  const args = [
    script,
    "--base",
    baseUrl,
    "--executor-id",
    profile.executorId,
    "--agent-name",
    profile.displayName,
    "--tool-name",
    toolName,
  ];

  const proc = spawn(process.execPath, args, {
    detached: true,
    stdio: "ignore",
    shell: false,
    env: {
      ...process.env,
      OPENX_SKILLS_DIR: getOpenxSkillsDir(),
    },
  });
  proc.unref();
  bootstrapped.set(profile.executorId, proc);
  proc.on("exit", () => {
    bootstrapped.delete(profile.executorId);
  });

  return {
    command: getBootstrapCommand(profile, baseUrl),
    pid: proc.pid,
  };
}

/** 测试用 */
export function resetBootstrapProcesses(): void {
  for (const proc of bootstrapped.values()) {
    try {
      proc.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  bootstrapped.clear();
}
