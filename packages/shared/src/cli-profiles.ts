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
  notes?: string;
};

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

  return {
    userDraft: `请根据接入教程安装并配置 Connect Agent「${input.cliName}」，完成后在 OpenX 中可派单执行。教程：${tutorial}${notesBlock}`,
    title: `接入 Connect Agent：${input.cliName}`,
    acceptance: [
      "Agent 已通过 POST /api/connect 注册并在 OpenX 中显示在线",
      "settings.cliProfiles 已写入该 Agent（含自动生成的 executorId）",
      "可为该 executorId 创建测试目标并成功派单",
    ].join("；"),
    executionPrompt: [
      `你是 OpenX 的 Pi 执行器。请完成 Connect Agent「${input.cliName}」的接入。`,
      `1. 阅读并遵循接入教程：${tutorial}`,
      "2. 若教程指向 OpenX 自带 connect-client，可使用 pnpm connect:demo 或仓库内 packages/connect-client",
      "3. 自行生成 executorId（小写字母开头，仅字母数字/_/-），不要向用户索要",
      "4. 安装/启动 Agent 后，向 OpenX POST /api/cli/profiles 写入 CliProfile（kind=connect，含 tutorialUrl）",
      "5. 启动 Agent 并完成 POST /api/connect 注册；确认工具页显示该 Agent 在线",
      "6. 在任务日志中记录 executorId、启动命令与验证步骤",
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

export function buildConnectBootstrapCommand(opts: {
  executorId: string;
  displayName: string;
  toolName?: string;
  baseUrl: string;
  projectRoot?: string;
  skillsDir?: string;
}): string {
  const tool = opts.toolName ?? opts.executorId;
  const root = opts.projectRoot ?? ".";
  const skillsDir = opts.skillsDir ?? "~/.openx/skills";
  return [
    `# Skills 目录：${skillsDir}（自举 spawn 会自动设置 OPENX_SKILLS_DIR）`,
    `pnpm --dir "${root}" connect:demo -- --base ${opts.baseUrl} --executor-id ${opts.executorId} --agent-name "${opts.displayName}" --tool-name ${tool}`,
  ].join("\n");
}
