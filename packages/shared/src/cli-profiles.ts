import { z } from "zod";

/** 用户添加的 Connect / 自定义 CLI 配置（持久化在 settings.cliProfiles） */
export const CliProfileSchema = z.object({
  executorId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_-]*$/i, "executorId 仅允许字母数字、下划线与连字符"),
  displayName: z.string().min(1).max(80),
  kind: z.enum(["connect", "acp"]).default("connect"),
  toolName: z.string().min(1).max(64).optional(),
  tutorialUrl: z.string().url().optional(),
  templateId: z.string().optional(),
  addedAt: z.string(),
});
export type CliProfile = z.infer<typeof CliProfileSchema>;

/** Connect 一键自举进程阶段（服务端内存态，重启后清空） */
export const ConnectBootstrapPhaseSchema = z.enum([
  "idle",
  "spawning",
  "running",
  "exited",
  "online",
]);
export type ConnectBootstrapPhase = z.infer<typeof ConnectBootstrapPhaseSchema>;

export const ConnectBootstrapStatusSchema = z.object({
  executorId: z.string(),
  phase: ConnectBootstrapPhaseSchema,
  pid: z.number().int().positive().optional(),
  startedAt: z.string().optional(),
  exitCode: z.number().int().nullable().optional(),
  online: z.boolean(),
  lastError: z.string().optional(),
});
export type ConnectBootstrapStatus = z.infer<typeof ConnectBootstrapStatusSchema>;

export const BootstrapConnectBodySchema = z.object({
  /** 自举后轮询等待 Agent 注册上线 */
  wait: z.boolean().optional(),
});
export type BootstrapConnectBody = z.infer<typeof BootstrapConnectBodySchema>;

export type CliTemplate = {
  id: string;
  kind: "connect" | "acp";
  name: string;
  description: string;
  tutorialUrl: string;
  /** 预设 executorId（ACP）或建议前缀（Connect） */
  suggestedExecutorId: string;
  docsHint?: string;
};

/** 添加 CLI 时可选的模板（含教程链接） */
export const CLI_TEMPLATES: CliTemplate[] = [
  {
    id: "connect-custom",
    kind: "connect",
    name: "Connect Agent",
    description: "外部 Agent 通过 Connect 协议注册并由心跳拉取任务。",
    tutorialUrl: "https://github.com/openx/openx#connect-agent",
    suggestedExecutorId: "custom-agent",
  },
  {
    id: "acp-codex",
    kind: "acp",
    name: "Codex CLI (ACP)",
    description: "OpenAI Codex 通过 ACP 协议接入（acp:codex）。",
    tutorialUrl: "https://developers.openai.com/codex/",
    suggestedExecutorId: "acp:codex",
  },
  {
    id: "acp-claude",
    kind: "acp",
    name: "Claude Code (ACP)",
    description: "Anthropic Claude Code ACP 运行时（acp:claude）。",
    tutorialUrl: "https://docs.anthropic.com/en/docs/claude-code",
    suggestedExecutorId: "acp:claude",
  },
  {
    id: "acp-gemini",
    kind: "acp",
    name: "Gemini CLI (ACP)",
    description: "Google Gemini CLI ACP 运行时（acp:gemini）。",
    tutorialUrl: "https://github.com/google-gemini/gemini-cli",
    suggestedExecutorId: "acp:gemini",
  },
];

export type CliIntegrationInput = {
  cliName: string;
  tutorialUrl: string;
  kind: "acp" | "connect";
  /** ACP 内置 executorId，如 acp:claude */
  targetExecutorId?: string;
  /** Connect 已预注册的 executorId（AddCliDialog 写入 settings 后传入） */
  connectExecutorId?: string;
  /** OpenX API 根地址，供 Pi 调用 bootstrap / executors */
  serverBaseUrl?: string;
  notes?: string;
};

export type ConnectBootstrapOpts = {
  executorId: string;
  displayName: string;
  toolName?: string;
  baseUrl: string;
};

/** connect-client CLI 参数（与 server spawn 一致） */
export function buildConnectClientArgv(
  scriptPath: string,
  opts: ConnectBootstrapOpts,
): string[] {
  const tool = opts.toolName ?? opts.executorId;
  return [
    scriptPath,
    "--base",
    opts.baseUrl,
    "--executor-id",
    opts.executorId,
    "--agent-name",
    opts.displayName,
    "--tool-name",
    tool,
  ];
}

function quoteShellArg(value: string): string {
  if (/[\s"\\]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

export function formatShellCommand(executable: string, args: string[]): string {
  return [quoteShellArg(executable), ...args.map(quoteShellArg)].join(" ");
}

export type CliIntegrationGoalPayload = {
  userDraft: string;
  title: string;
  acceptance: string;
  executionPrompt: string;
};

/** 由 Pi 执行的 CLI 接入任务文案（不走 Coach refine 时可直接使用） */
export function buildCliIntegrationGoal(input: CliIntegrationInput): CliIntegrationGoalPayload {
  const notesBlock = input.notes?.trim() ? `\n\n用户补充：${input.notes.trim()}` : "";
  const tutorial = input.tutorialUrl.trim();

  if (input.kind === "acp" && input.targetExecutorId) {
    const execId = input.targetExecutorId;
    return {
      userDraft: `请根据接入教程安装并配置 ${input.cliName}，使其在 OpenX 中作为 ${execId} 可用。教程：${tutorial}${notesBlock}`,
      title: `接入 ${input.cliName}`,
      acceptance: [
        `OpenX「工具 → CLI」中 ${execId} 显示为可用（● 可用）`,
        "本机可正常启动该 CLI 的 ACP 模式",
        "在任务执行器列表中可选择该 CLI",
      ].join("；"),
      executionPrompt: [
        `你是 OpenX 的 Pi 执行器。请完成 ${input.cliName}（${execId}）的安装与接入。`,
        `1. 阅读并遵循接入教程：${tutorial}`,
        "2. 在本机安装/更新 CLI，完成登录或鉴权（若教程要求）",
        "3. 验证 ACP 模式可启动（参考教程中的 acp 启动命令）",
        `4. 确认 OpenX 服务端检测通过：executorId 为 ${execId}，工具页状态为可用`,
        "5. 在任务日志中简要说明安装步骤、版本与验证结果",
        "不要修改 OpenX 源码；仅完成 CLI 安装与验证。",
        notesBlock,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  const execId = input.connectExecutorId?.trim();
  const base = (input.serverBaseUrl ?? "http://127.0.0.1:3921").replace(/\/$/, "");

  if (execId) {
    return {
      userDraft: `请完成 Connect Agent「${input.cliName}」（executorId=${execId}）的启动与上线。${notesBlock}`,
      title: `接入 Connect Agent：${input.cliName}`,
      acceptance: [
        `executorId=${execId} 在 OpenX 工具页显示为在线（● 可用）`,
        "POST /api/cli/profiles/{id}/bootstrap 已成功或等效启动 connect-client",
        `可为 ${execId} 创建测试目标并成功派单`,
      ].join("；"),
      executionPrompt: [
        `你是 OpenX 的 Pi 执行器。Connect Agent「${input.cliName}」的 CliProfile 已写入 settings（executorId=${execId}）。`,
        "禁止根据教程链接安装第三方 CLI、爬取网页或执行 obscura/curl 安装脚本；本任务只需启动已内置的 connect-client。",
        `1. 调用 OpenX API 一键自举：POST ${base}/api/cli/profiles/${execId}/bootstrap，body: {"wait":true}`,
        `2. 若返回 online=false，执行 GET ${base}/api/cli/profiles/${execId}/bootstrap 获取 command，在本机终端运行`,
        `3. 轮询 GET ${base}/api/executors，直到 ${execId} 显示 available=true`,
        "4. 若报错「未找到 connect-client」，在仓库根目录执行：pnpm --filter @openx/connect-client build，然后重试 bootstrap",
        "5. 在任务日志中记录 bootstrap 响应（online/pid/error）与 executors 检测结果",
        "优先使用 openx MCP（openx_call_api）调用上述 API；不要修改 OpenX 源码。",
        notesBlock,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  return {
    userDraft: `请根据接入教程安装并配置 Connect Agent「${input.cliName}」，完成后在 OpenX 中可派单执行。教程：${tutorial}${notesBlock}`,
    title: `接入 Connect Agent：${input.cliName}`,
    acceptance: [
      "Agent 已通过 POST /api/connect 注册并在 OpenX 中显示在线",
      "settings.cliProfiles 已写入该 Agent（含 executorId）",
      "可为该 executorId 创建测试目标并成功派单",
    ].join("；"),
    executionPrompt: [
      `你是 OpenX 的 Pi 执行器。请完成 Connect Agent「${input.cliName}」的接入。`,
      `1. 阅读并遵循接入教程：${tutorial}`,
      "2. 生成 executorId（小写字母开头，仅字母数字/_/-），POST /api/cli/profiles 写入 CliProfile（kind=connect）",
      "3. 调用 POST /api/cli/profiles/{executorId}/bootstrap 启动 connect-client",
      "4. 轮询 GET /api/executors 直到该 executorId 在线",
      "5. 在任务日志中记录 executorId、bootstrap 结果与验证步骤",
      "优先使用 openx MCP（openx_call_api）。",
      notesBlock,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/** 添加 CLI 弹窗：过滤已在线的 ACP 运行时 */
export function listAvailableCliTemplates(existingExecutorIds: string[]): CliTemplate[] {
  const idSet = new Set(existingExecutorIds);
  return CLI_TEMPLATES.filter((t) => {
    if (t.kind === "acp") {
      return !idSet.has(t.suggestedExecutorId);
    }
    return true;
  });
}

export function slugifyExecutorId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/^[^a-z]+/, "agent-")
    .slice(0, 64) || "my-agent";
}

export function buildConnectBootstrapCommand(opts: ConnectBootstrapOpts & {
  nodePath?: string;
  scriptPath?: string;
  projectRoot?: string;
  skillsDir?: string;
}): string {
  const tool = opts.toolName ?? opts.executorId;
  const root = opts.projectRoot ?? ".";
  const skillsDir = opts.skillsDir ?? "~/.openx/skills";
  const lines = [
    `# Skills：OPENX_SKILLS_DIR=${skillsDir}（服务端 POST bootstrap 会自动注入）`,
  ];

  if (opts.nodePath && opts.scriptPath) {
    const argv = buildConnectClientArgv(opts.scriptPath, {
      executorId: opts.executorId,
      displayName: opts.displayName,
      toolName: opts.toolName,
      baseUrl: opts.baseUrl,
    });
    lines.push(formatShellCommand(opts.nodePath, argv));
    lines.push("");
    lines.push("# 或在仓库根目录（会先 build connect-client）：");
  }

  lines.push(
    `pnpm --dir "${root}" connect:demo -- --base ${opts.baseUrl} --executor-id ${opts.executorId} --agent-name "${opts.displayName}" --tool-name ${tool}`,
  );
  return lines.join("\n");
}
