import type { LlmContextSettings } from "./llm-context-config.js";
import {
  flattenTemplateVars,
  listPromptSectionsForRole,
  renderPromptTemplate,
  resolveLlmContextConfig,
  type LlmPromptRole,
} from "./llm-context-config.js";
import type { LlmRuntimeSnapshot } from "./llm-runtime-snapshot.js";

function minimalRuntimeSnapshot(
  config: ReturnType<typeof resolveLlmContextConfig>,
  partial?: Partial<LlmRuntimeSnapshot>,
): LlmRuntimeSnapshot {
  return {
    product: config.meta.productName,
    version: config.meta.version,
    nowIso: new Date().toISOString(),
    nowLocal: "",
    timezone: config.timezone,
    locale: config.locale,
    environmentLabel: partial?.environmentLabel ?? "",
    baseUrl: partial?.baseUrl ?? "",
    catalogEndpointCount: partial?.catalogEndpointCount ?? 0,
    systemWorkspace: partial?.systemWorkspace ?? "",
    workspaceRoot: partial?.workspaceRoot ?? "",
    projectName: partial?.projectName ?? "",
    executorsSummary: partial?.executorsSummary ?? "",
    operatorTier: partial?.operatorTier ?? "off",
    operatorCapabilities: partial?.operatorCapabilities ?? "",
    playbookSummary: partial?.playbookSummary ?? "",
    intentHint: partial?.intentHint ?? "",
    audienceLabel: partial?.audienceLabel ?? "",
    audienceSummary: partial?.audienceSummary ?? "",
    conversationKind: partial?.conversationKind ?? "project",
  };
}

/** 按 role 渲染 system prompt（review/rollup/connect 等轻量角色） */
export function buildRoleSystemPrompt(
  role: LlmPromptRole,
  llmContextSettings?: Partial<LlmContextSettings> | null,
  runtimePartial?: Partial<LlmRuntimeSnapshot>,
): string {
  const config = resolveLlmContextConfig(llmContextSettings);
  const snapshot = minimalRuntimeSnapshot(config, runtimePartial);
  const vars = flattenTemplateVars(config, snapshot);
  const sections = listPromptSectionsForRole(config, role);
  const rendered = sections.map((s) =>
    renderPromptTemplate(s.content, vars).trim(),
  );
  for (const extra of config.extraSections) {
    rendered.push(`# ${extra.title}\n${extra.content.trim()}`);
  }
  return rendered.filter(Boolean).join("\n\n");
}
