import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type VerifyCommandResult = {
  command: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  ok: boolean;
};

const MAX_COMMANDS = 3;
const COMMAND_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 8_000;

const BLOCKED_PATTERN =
  /[;&|$`><]|\brm\s+-rf\b|\bsudo\b|\bcurl\b.*\|/i;

const ALLOWED_PREFIX =
  /^(npm|pnpm|yarn|npx|vitest|jest|pytest|python|cargo|go|node)\b/i;

const NODE_E_RE = /^node\s+-e\s+/i;

const INLINE_VERIFY_RE =
  /\b(npm\s+(?:run\s+)?test|pnpm\s+(?:run\s+)?test|yarn\s+test|pnpm\s+lint|npm\s+run\s+lint|npx\s+vitest(?:\s+run)?|pytest(?:\s+[\w./-]+)?|cargo\s+test|go\s+test(?:\s+[\w./-]+)?)\b/gi;

function trimOutput(text: string): string {
  const t = text.trim();
  if (t.length <= MAX_OUTPUT_CHARS) return t;
  return `${t.slice(0, MAX_OUTPUT_CHARS)}\n…（输出已截断）`;
}

export function isAllowedVerifyCommand(command: string): boolean {
  const cmd = command.trim();
  if (!cmd || cmd.length > 240) return false;
  if (BLOCKED_PATTERN.test(cmd)) return false;
  if (NODE_E_RE.test(cmd)) return true;
  return ALLOWED_PREFIX.test(cmd);
}

export function inferVerifyCommands(
  texts: string[],
  workspaceRoot: string,
): string[] {
  const found = new Set<string>();

  for (const text of texts) {
    if (!text?.trim()) continue;
    for (const m of text.matchAll(/`([^`]+)`/g)) {
      const cmd = m[1]?.trim();
      if (cmd && isAllowedVerifyCommand(cmd)) found.add(cmd);
    }
    INLINE_VERIFY_RE.lastIndex = 0;
    for (const m of text.matchAll(INLINE_VERIFY_RE)) {
      const cmd = m[1]?.trim();
      if (cmd && isAllowedVerifyCommand(cmd)) found.add(cmd);
    }
  }

  for (const cmd of discoverPackageScripts(workspaceRoot)) {
    found.add(cmd);
  }

  return [...found].slice(0, MAX_COMMANDS);
}

function discoverPackageScripts(workspaceRoot: string): string[] {
  const pkgPath = join(workspaceRoot, "package.json");
  if (!existsSync(pkgPath)) return [];

  let scripts: Record<string, string> | undefined;
  try {
    const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      scripts?: Record<string, string>;
    };
    scripts = parsed.scripts;
  } catch {
    return [];
  }
  if (!scripts) return [];

  const pm = existsSync(join(workspaceRoot, "pnpm-lock.yaml"))
    ? "pnpm"
    : existsSync(join(workspaceRoot, "yarn.lock"))
      ? "yarn"
      : "npm";

  const cmds: string[] = [];
  const priority = ["test", "verify", "lint", "typecheck", "check"] as const;
  for (const key of priority) {
    if (!scripts[key]) continue;
    if (pm === "yarn" && key === "test") cmds.push("yarn test");
    else if (pm === "pnpm") cmds.push(`pnpm run ${key}`);
    else cmds.push(`npm run ${key}`);
    if (cmds.length >= 2) break;
  }
  return cmds.filter(isAllowedVerifyCommand);
}

export function runVerifyCommand(
  workspaceRoot: string,
  command: string,
): VerifyCommandResult {
  const result = spawnSync(command, {
    cwd: workspaceRoot,
    shell: true,
    encoding: "utf8",
    timeout: COMMAND_TIMEOUT_MS,
    env: process.env,
    windowsHide: true,
  });

  const timedOut = result.error?.message.includes("ETIMEDOUT") ?? false;
  const exitCode = result.status;
  const ok = exitCode === 0 && !timedOut;

  return {
    command,
    exitCode,
    signal: result.signal,
    stdout: trimOutput(result.stdout ?? ""),
    stderr: trimOutput(result.stderr ?? ""),
    timedOut,
    ok,
  };
}

export function runReviewVerification(
  workspaceRoot: string,
  texts: string[],
): VerifyCommandResult[] {
  const commands = inferVerifyCommands(texts, workspaceRoot);
  if (commands.length === 0) return [];
  return commands.map((command) => runVerifyCommand(workspaceRoot, command));
}

export function formatVerifyEvidenceBlock(results: VerifyCommandResult[]): string {
  if (results.length === 0) {
    return "## 验证命令输出（compose:verify）\n（未从验收标准/项目脚本推断出可运行的验证命令）";
  }

  const blocks = results.map((r) => {
    const status = r.timedOut
      ? "超时"
      : r.ok
        ? "通过"
        : `失败（exit ${r.exitCode ?? "?"}）`;
    return [
      `### $ ${r.command}`,
      `状态：${status}`,
      r.stdout ? `stdout:\n\`\`\`\n${r.stdout}\n\`\`\`` : "stdout: （空）",
      r.stderr ? `stderr:\n\`\`\`\n${r.stderr}\n\`\`\`` : "",
    ]
      .filter(Boolean)
      .join("\n");
  });

  return ["## 验证命令输出（compose:verify）", ...blocks].join("\n\n");
}
