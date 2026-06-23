import type { CoachChatContext, CoachIntent } from "./coach.js";
import { DISPATCH_PERMISSION_LABELS, type DispatchPermissionMode } from "./dispatch-context.js";
import { classifyCoachIntent } from "./coach-intent.js";
import { buildApiCatalogResponse } from "./api-catalog.js";
import { OPERATOR_TIER_LABELS, type OperatorTier } from "./operator-tier.js";
import { buildOperatorPlaybook } from "./operator-playbook.js";
import type { LlmContextSettings } from "./llm-context-config.js";
import {
  detectSystemLocale,
  detectSystemTimezone,
  flattenTemplateVars,
  renderPromptTemplate,
  resolveLlmContextConfig,
  listPromptSectionsForRole,
  type LlmPromptRole,
  type ResolvedLlmContextConfig,
} from "./llm-context-config.js";
import { predictAudienceProfile, type LlmAudienceProfile } from "./llm-audience.js";

export type { LlmAudienceProfile };

export type LlmRuntimeSnapshot = {
  product: string;
  version: string;
  nowIso: string;
  nowLocal: string;
  timezone: string;
  locale: string;
  environmentLabel: string;
  baseUrl: string;
  catalogEndpointCount: number;
  systemWorkspace: string;
  workspaceRoot: string;
  projectName: string;
  executorsSummary: string;
  operatorTier: OperatorTier;
  operatorCapabilities: string;
  dispatchPermissionMode: DispatchPermissionMode | "default";
  dispatchPermissionLabel: string;
  playbookSummary: string;
  intentHint: string;
  audienceLabel: string;
  audienceSummary: string;
  conversationKind: "system" | "project";
};

export type BuildLlmRuntimeSnapshotInput = {
  context: CoachChatContext;
  message?: string;
  baseUrl?: string;
  llmContextSettings?: Partial<LlmContextSettings> | null;
  /** 浏览器/客户端时区（对话请求自动附带，无需用户配置） */
  clientTimezone?: string;
  /** 浏览器/客户端 locale */
  clientLocale?: string;
  nodeEnv?: string;
  conversationKind?: "system" | "project";
};

function formatOperatorCapabilities(tier: OperatorTier): string {
  const meta = OPERATOR_TIER_LABELS[tier];
  const lines = [`- 当前分级：${tier}（${meta.label}）— ${meta.description}`];
  if (tier === "off") {
    lines.push("- 无 openx_* 工具；仅对话与任务单模式");
  } else if (tier === "read") {
    lines.push("- 可 openx_list_apis / openx_get_catalog / 只读 GET");
  } else if (tier === "operator") {
    lines.push("- 可创建项目/对话/目标、派单、Connect bootstrap");
  } else {
    lines.push("- 可修改 settings/模型/CLI/MCP/Agent（敏感写须 UI 确认）");
  }
  return lines.join("\n");
}

export function buildLlmRuntimeSnapshot(
  input: BuildLlmRuntimeSnapshotInput,
): LlmRuntimeSnapshot {
  const config = resolveLlmContextConfig(input.llmContextSettings);
  const now = new Date();
  const timezone =
    input.clientTimezone?.trim() || detectSystemTimezone();
  const locale = input.clientLocale?.trim() || detectSystemLocale();
  const nowLocal = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "long",
  }).format(now);

  const tier = input.context.operatorTier ?? "off";
  const dispatchMode = input.context.dispatchPermissionMode ?? "default";
  const dispatchLabel =
    dispatchMode === "default"
      ? "默认（完全授权）"
      : (DISPATCH_PERMISSION_LABELS[dispatchMode as Exclude<typeof dispatchMode, "default">]
          ?.label ?? dispatchMode);
  const catalog = buildApiCatalogResponse();
  const playbook = buildOperatorPlaybook(input.baseUrl);
  const audience = predictAudienceProfile(
    input.message,
    input.context,
    input.llmContextSettings,
  );
  const intent: CoachIntent | undefined = input.message
    ? classifyCoachIntent(input.message)
    : undefined;

  const nodeEnv = input.nodeEnv ?? process.env.NODE_ENV ?? "development";
  const envLabel =
    nodeEnv === "production"
      ? "生产"
      : nodeEnv === "test"
        ? "测试"
        : "开发/本地";

  return {
    product: config.meta.productName,
    version: config.meta.version,
    nowIso: now.toISOString(),
    nowLocal,
    timezone,
    locale,
    environmentLabel: envLabel,
    baseUrl: input.baseUrl ?? playbook.baseUrl,
    catalogEndpointCount: catalog.meta.endpointCount,
    systemWorkspace: input.context.workspaceRoot ?? "（未设置）",
    workspaceRoot: input.context.workspaceRoot ?? "（未设置）",
    projectName: input.context.projectName ?? "",
    executorsSummary: input.context.executors?.join("、") ?? "pi",
    operatorTier: tier,
    operatorCapabilities: formatOperatorCapabilities(tier),
    dispatchPermissionMode: dispatchMode,
    dispatchPermissionLabel: dispatchLabel,
    playbookSummary: playbook.concepts.slice(0, 4).join("\n"),
    intentHint: intent ?? "（无当前消息）",
    audienceLabel: audience.label,
    audienceSummary: audience.summary,
    conversationKind: input.conversationKind ?? "project",
  };
}

export function snapshotToTemplateVars(
  snapshot: LlmRuntimeSnapshot,
): Record<string, string | number | undefined> {
  return { ...snapshot };
}

export function renderConfiguredPromptSections(
  role: LlmPromptRole,
  config: ResolvedLlmContextConfig,
  snapshot: LlmRuntimeSnapshot,
): string {
  const vars = flattenTemplateVars(config, snapshotToTemplateVars(snapshot));
  const sections = listPromptSectionsForRole(config, role);
  const rendered = sections.map((s) =>
    renderPromptTemplate(s.content, vars).trim(),
  );
  for (const extra of config.extraSections) {
    rendered.push(`# ${extra.title}\n${extra.content.trim()}`);
  }
  return rendered.filter(Boolean).join("\n\n");
}
