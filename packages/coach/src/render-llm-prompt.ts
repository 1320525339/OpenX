import type { CoachChatContext, CoachGoalBrief, LlmContextSettings } from "@openx/shared";
import {
  renderConfiguredPromptSections,
  resolveLlmContextConfig,
  type LlmPromptRole,
  type LlmRuntimeSnapshot,
} from "@openx/shared";

function formatGoalBriefBlock(label: string, goal: CoachGoalBrief): string {
  const lines = [
    `${label}`,
    `  标题：${goal.title}`,
    `  状态：${goal.status}（${goal.progress}%）`,
    `  执行器：${goal.executorId}`,
  ];
  if (goal.acceptance) {
    lines.push(`  验收：${goal.acceptance}`);
  }
  if (goal.resultSummary) {
    lines.push(`  结果摘要：${goal.resultSummary}`);
  }
  return lines.join("\n");
}

/** 任务/项目相关的动态运行时块（非静态配置） */
export function renderCoachDynamicContext(context: CoachChatContext): string {
  const blocks: string[] = ["# 当前任务与项目上下文"];

  if (context.northStar) {
    blocks.push("");
    blocks.push(formatGoalBriefBlock("## 核心目标（North Star）", context.northStar));
  }
  if (context.subGoals?.length) {
    blocks.push("");
    blocks.push("## 子任务");
    for (const sub of context.subGoals) {
      blocks.push(formatGoalBriefBlock(`- ${sub.title}`, sub));
    }
  }
  if (context.selectedGoal && context.selectedGoal.id !== context.northStar?.id) {
    blocks.push("");
    blocks.push(formatGoalBriefBlock("## 用户当前选中", context.selectedGoal));
  }
  if (context.goalsSummary) {
    blocks.push("");
    blocks.push("## 任务一览");
    blocks.push(context.goalsSummary);
  }
  if (context.feedbackNotes) {
    blocks.push("");
    blocks.push("## 选中任务执行反馈");
    blocks.push(context.feedbackNotes);
  }
  if (context.defaultConstraints?.length) {
    blocks.push("");
    blocks.push("## 工头行为准则");
    blocks.push(context.defaultConstraints.map((c) => `- ${c}`).join("\n"));
  }
  if (context.enabledSkills?.length) {
    blocks.push("");
    blocks.push("## 对话启用的 Skills");
    blocks.push(
      context.enabledSkills.map((s) => `- ${s.name} (${s.id}): ${s.desc}`).join("\n"),
    );
  }
  if (context.enabledMcps?.length) {
    blocks.push("");
    blocks.push("## 对话启用的 MCP");
    blocks.push(context.enabledMcps.map((m) => `- ${m.name} (${m.id})`).join("\n"));
  }
  // 工头身份已在 system prompt identity 段；非工头角色仅作执行阶段配置，不注入对话上下文
  if (context.contextPack) {
    blocks.push("");
    blocks.push("## 项目上下文（只读快照，供拆解参考，勿当作已执行结果）");
    blocks.push(`根目录：${context.contextPack.root}`);
    blocks.push("### 目录结构");
    blocks.push(context.contextPack.fileTree);
    if (context.contextPack.keyFiles.length > 0) {
      blocks.push("### 关键文件摘要");
      for (const kf of context.contextPack.keyFiles) {
        blocks.push(`#### ${kf.path}\n${kf.summary}`);
      }
    }
  }
  if (context.projectMemory?.trim()) {
    blocks.push("");
    blocks.push(context.projectMemory.trim());
  }
  if (context.browserDesktopContext?.trim()) {
    blocks.push("");
    blocks.push(context.browserDesktopContext.trim());
  }

  if (blocks.length === 1) return "";
  return blocks.join("\n");
}

export function buildConfiguredSystemPrompt(
  role: LlmPromptRole,
  context: CoachChatContext,
  llmContextSettings?: Partial<LlmContextSettings> | null,
): string {
  const resolvedConfig = resolveLlmContextConfig(
    llmContextSettings ?? context.llmContextSettings,
  );
  const snapshot: LlmRuntimeSnapshot =
    context.runtimeSnapshot ??
    ({
      product: resolvedConfig.meta.productName,
      version: resolvedConfig.meta.version,
      nowIso: new Date().toISOString(),
      nowLocal: "",
      timezone: resolvedConfig.timezone,
      locale: resolvedConfig.locale,
      environmentLabel: "未知",
      baseUrl: "http://127.0.0.1:3921",
      catalogEndpointCount: 0,
      systemWorkspace: context.workspaceRoot ?? "",
      workspaceRoot: context.workspaceRoot ?? "",
      executorsSummary: context.executors?.join("、") ?? "pi",
      operatorTier: context.operatorTier ?? "off",
      operatorCapabilities: "",
      dispatchPermissionMode: context.dispatchPermissionMode ?? "default",
      dispatchPermissionLabel: "默认（完全授权）",
      playbookSummary: "",
      intentHint: "",
      audienceLabel: "",
      audienceSummary: "",
      projectName: context.projectName ?? "",
      conversationKind: "project",
    } satisfies LlmRuntimeSnapshot);

  const parts = [
    renderConfiguredPromptSections(role, resolvedConfig, snapshot),
    renderCoachDynamicContext(context),
  ];
  return parts.filter(Boolean).join("\n\n");
}

export function buildRefineSystemPrompt(
  llmContextSettings?: Partial<LlmContextSettings> | null,
): string {
  const resolvedConfig = resolveLlmContextConfig(llmContextSettings);
  return renderConfiguredPromptSections("refine", resolvedConfig, {
    product: resolvedConfig.meta.productName,
    version: resolvedConfig.meta.version,
    nowIso: new Date().toISOString(),
    nowLocal: "",
    timezone: resolvedConfig.timezone,
    locale: resolvedConfig.locale,
    environmentLabel: "",
    baseUrl: "",
    catalogEndpointCount: 0,
    systemWorkspace: "",
    workspaceRoot: "",
    executorsSummary: "",
    operatorTier: "off",
    operatorCapabilities: "",
    dispatchPermissionMode: "default",
    dispatchPermissionLabel: "默认（完全授权）",
    playbookSummary: "",
    intentHint: "",
    audienceLabel: "",
    audienceSummary: "",
    projectName: "",
    conversationKind: "project",
  });
}
