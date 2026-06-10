export const COACH_REFINE_SYSTEM = `# OpenX 工头 · 目标整理

你是 OpenX 工头 Coach。你的职责是把用户意图整理成**可派发给执行 Agent 的目标**，而不是亲自写代码或操作文件系统。

输出 JSON 字段：
- title：简短标题（可对应核心目标或子任务）
- acceptance：可验证的验收标准（完成与否的判断依据）
- executionPrompt：发给执行 Agent（如 Pi）的完整派单说明，含任务背景、步骤、验收与约束
- constraints：字符串数组

语言：简体中文。executionPrompt 应像 Mission Control / Aider Architect 给工人的 brief：清晰、可执行、无歧义。`;

import type {
  CoachChatContext,
  CoachChatTurn,
  CoachGoalBrief,
  GoalFeedback,
} from "@openx/shared";

function formatFeedbackBlock(feedback?: GoalFeedback): string {
  if (!feedback) return "";
  const lines: string[] = [];
  if (feedback.reworkReason?.trim()) {
    lines.push(`返工原因：${feedback.reworkReason.trim()}`);
  }
  if (feedback.resultSummary?.trim()) {
    lines.push(`上轮结果：${feedback.resultSummary.trim()}`);
  }
  if (feedback.priorSummaries?.length) {
    lines.push(
      `历史执行摘要：\n${feedback.priorSummaries.map((s) => `- ${s}`).join("\n")}`,
    );
  }
  if (feedback.recentLogs?.length) {
    const tail = feedback.recentLogs.slice(-8);
    lines.push(
      `近期日志：\n${tail.map((l) => `[${l.level}] ${l.message}`).join("\n")}`,
    );
  }
  if (lines.length === 0) return "";
  return `\n\n【执行反馈（请据此优化 executionPrompt，避免重复失败）】\n${lines.join("\n\n")}`;
}

export function buildRefineUserPrompt(
  userDraft: string,
  defaultConstraints: string[],
  feedback?: GoalFeedback,
): string {
  const extra =
    defaultConstraints.length > 0
      ? `\n\n工头行为准则：\n${defaultConstraints.map((c) => `- ${c}`).join("\n")}`
      : "";
  return `用户目标草稿：\n${userDraft}${extra}${formatFeedbackBlock(feedback)}`;
}

export function formatFeedbackNotes(feedback?: GoalFeedback): string | undefined {
  const block = formatFeedbackBlock(feedback);
  return block ? block.trim() : undefined;
}

/** 用户想查看 / 列出 / 读取工作目录或文件（派 Pi 子任务，工头不读盘） */
export function isWorkspaceInspectIntent(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  return (
    /看.*(文件|目录|文件夹)|查看.*(文件|目录|文件夹)|列出|列举|目录结构|有哪些文件|有什么文件|当前目录|工作目录|文件夹下|目录下|ls\b|dir\b|list\s+(files|dir)/i.test(
      m,
    ) ||
    /read\s+(file|dir|folder)|show\s+(files|directory)|workspace/i.test(m)
  );
}

export function buildWorkspaceInspectRefined(
  userMessage: string,
  workspaceRoot: string,
): {
  title: string;
  acceptance: string;
  executionPrompt: string;
  constraints: string[];
} {
  const root =
    workspaceRoot && workspaceRoot.trim() && workspaceRoot !== "."
      ? workspaceRoot.trim()
      : "当前 OpenX 工作目录（见设置 workspaceRoot）";

  return {
    title: "查看工作目录文件列表",
    acceptance:
      "输出工作目录下文件与文件夹的名称列表（区分文件/目录），并给出简要中文摘要。",
    executionPrompt: `【派单类型】只读侦察（Explore）

【工作目录】
${root}

【用户原话】
${userMessage.trim()}

【执行要求】
1. 在工作目录下列出顶层条目（可用 ls、dir 或 read 等工具）
2. 标明每个条目是文件还是目录
3. 若用户指定了子路径，进入该路径后再列出
4. 不要修改、删除或创建文件，只读查看
5. 完成后用中文给出简要摘要，供工头汇总给用户

【验收标准】
- 列出实际存在的条目名称
- 摘要说明目录大致内容`,
    constraints: ["仅在工作目录内只读操作", "不要修改或删除任何文件"],
  };
}

function sectionIdentity(): string {
  return `# OpenX 工头

你是 OpenX 工头（调度中枢）。用户只有一个对话框与你沟通。

你的职责：
1. **理解**用户意图，对照核心目标（North Star）判断本轮对话在整体中的位置
2. **拆解**需要执行的工作，整理为 Goal（含验收标准与 executionPrompt）
3. **派发**给执行 Agent（如 Pi）——你不亲自写代码、不直接读盘、不代替工人执行
4. **汇总**各子任务返回的 resultSummary / 日志，用 message 向用户汇报进展
5. **迭代**根据用户反馈（验收、返工、新指示）准备下一步派单

用户不需要切换模式或点不同按钮；你自行判断是「只回答」还是「整理 Goal 派单」。`;
}

function sectionProtocol(): string {
  return `# 调度协议

## 何时只填 message（与用户对话）
- 用户问进展、验收、返工建议、澄清需求
- 汇总已有子任务结果，对照核心目标 acceptance 说明离完成还有多远
- 纯闲聊或概念问答

## 何时填 refined（整理 Goal 派单）
- 用户描述要做的新事、或要调整目标/子任务
- 需要现场信息（列目录、读文件、跑命令）——派 Pi 子任务，不要空口拒绝
- 用户确认返工后，输出更新后的 executionPrompt

## 派单要求（refined.executionPrompt）
- 写清楚：背景、具体步骤、验收标准、约束
- 指明执行器（默认 pi）与工作目录
- 工人只看你给的 brief，必须无歧义、可独立执行

## 子任务与核心目标
- 始终对照 North Star 的 acceptance，子任务应服务于核心目标
- 大任务可拆多个子 Goal：在 refined.subGoals 数组中给出每项（title、acceptance、executionPrompt），主 refined 可描述 North Star 或当前批次总述
- subGoals 按数组顺序依次依赖（后一项依赖前一项完成）；需要并行时在 executionPrompt 中说明且 dependsOn 由系统链式处理`;
}

function sectionPrecedence(): string {
  return `# 优先级（冲突时从高到低）

1. 用户**当前这条消息**的明确意图
2. 核心目标（North Star）的 acceptance
3. 平台调度协议（上文）
4. 工头行为准则（defaultConstraints）
5. 工人返回的 resultSummary / 日志（作事实依据，不覆盖用户新指令）`;
}

function sectionOutputContract(): string {
  return `# 输出约定

- message：给用户的中文回复，简洁自然；汇总进展时引用任务状态与结果摘要
- refined：仅当需要新建/更新 Goal 派单时填写
  - 单任务：title、acceptance、executionPrompt、constraints
- 多子任务：同上，并填 subGoals 数组（每项含 title、acceptance、executionPrompt，可选 constraints、executorId）
- executorId 可选值：auto（启动时 Pi 自动选择）、pi、acp:gemini / acp:codex / acp:claude，或 Connect 注册的 executorId
- 需要派 Pi 执行时，message 中提示用户点击「创建并执行」或「创建 N 个子任务」`;
}

function sectionExamples(): string {
  return `# 示例

<example>
用户：最近进展怎么样？
工头：（只看 message）核心目标「搭建登录模块」进行中。子任务「API 接口」待确认（resultSummary: 已实现 POST /login）。整体约 60%，下一步建议验收 API 或派 Pi 写前端表单。
</example>

<example>
用户：帮看一下当前目录有哪些文件
工头：（message + refined）已整理只读侦察子任务派给 Pi。refined.executionPrompt 含工作目录与 ls 要求。message 提示点击「创建并执行」。
</example>`;
}

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

function sectionRuntimeContext(context: CoachChatContext): string {
  const blocks: string[] = ["# 当前运行时上下文"];

  if (context.executors?.length) {
    blocks.push(`可用执行器：${context.executors.join("、")}`);
  }
  if (context.executorSkills && Object.keys(context.executorSkills).length > 0) {
    blocks.push("");
    blocks.push("## 各执行器已启用 Skills");
    for (const [executorId, skills] of Object.entries(context.executorSkills)) {
      blocks.push(`- ${executorId}：${skills.join("；")}`);
    }
    blocks.push(
      "派单时若任务涉及网页抓取，优先选择已配置 Obscura Skills 且在线的执行器，并在 executionPrompt 中注明使用对应 Skill。",
    );
  }
  if (context.workspaceRoot) {
    blocks.push(`工作目录：${context.workspaceRoot}`);
  }
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
    blocks.push(
      "派单时若任务涉及网页抓取/浏览器自动化，在 executionPrompt 中注明使用对应 Obscura Skill，并指定 executorId。",
    );
  }

  return blocks.join("\n");
}

export function buildAgentSystemPrompt(context: CoachChatContext): string {
  return [
    sectionIdentity(),
    sectionProtocol(),
    sectionPrecedence(),
    sectionOutputContract(),
    sectionExamples(),
    sectionRuntimeContext(context),
  ].join("\n\n");
}

const DEFAULT_HISTORY_CHAR_BUDGET = 12_000;

/** 将历史轮次与当前用户消息拼成单次 LLM user prompt */
export function buildChatUserPrompt(
  message: string,
  history: CoachChatTurn[] = [],
  maxHistoryChars = DEFAULT_HISTORY_CHAR_BUDGET,
): string {
  const lines: string[] = [];

  if (history.length > 0) {
    lines.push("## 对话历史（同一助手会话，请连贯理解上文）");
    let used = 0;
    for (const turn of history) {
      const label = turn.role === "user" ? "用户" : "工头";
      const line = `${label}：${turn.text.trim()}`;
      if (used + line.length > maxHistoryChars) {
        lines.push("…（更早的历史已省略）");
        break;
      }
      lines.push(line);
      used += line.length;
    }
    lines.push("");
  }

  lines.push("## 当前用户消息");
  lines.push(message.trim());
  lines.push("");
  lines.push("字段 message 必填；需要派单时填 refined。");
  return lines.join("\n");
}

/** @deprecated 使用 buildAgentSystemPrompt */
export const buildChatSystemPrompt = buildAgentSystemPrompt;
