import type { CoachChatContext, RefinedGoal, RefineInput } from "@openx/shared";

export function refineGoalRules(
  input: RefineInput,
  defaultConstraints: string[] = [],
): RefinedGoal {
  const draft = input.userDraft.trim();
  const lines = draft
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const title =
    lines[0]?.length && lines[0].length <= 80
      ? lines[0].replace(/^#+\s*/, "")
      : draft.slice(0, 40) + (draft.length > 40 ? "…" : "");

  const acceptanceLine = lines.find(
    (l) =>
      /验收|完成标准|怎样算|done when|acceptance/i.test(l) ||
      l.startsWith("验收：") ||
      l.startsWith("验收:"),
  );
  const acceptance = acceptanceLine
    ? acceptanceLine.replace(/^验收[：:]\s*/i, "").trim()
    : `满足以下标准即视为完成：${title} 已按需求实现，并通过基本自测。`;

  const userConstraints = lines.filter((l) =>
    /^(禁止|仅|不要|必须|约束)[：:]/i.test(l),
  );
  const parsedConstraints = userConstraints.map((l) =>
    l.replace(/^(禁止|仅|不要|必须|约束)[：:]\s*/i, "").trim(),
  );
  const constraints = [
    ...new Set([...defaultConstraints, ...(input.constraints ?? []), ...parsedConstraints]),
  ];

  const constraintBlock =
    constraints.length > 0
      ? `\n\n【约束】\n${constraints.map((c) => `- ${c}`).join("\n")}`
      : "";

  let executionPrompt = `【任务】${title}

【目标描述】
${draft}

【验收标准】
${acceptance}${constraintBlock}

请按验收标准完成工作，完成后给出简要结果摘要。`;

  const fb = input.feedback;
  if (fb?.reworkReason?.trim()) {
    executionPrompt =
      `【返工】上一轮未通过。原因：${fb.reworkReason.trim()}\n\n` + executionPrompt;
  }
  if (fb?.resultSummary?.trim()) {
    executionPrompt += `\n\n【上轮结果】\n${fb.resultSummary.trim()}`;
  }
  if (fb?.recentLogs?.length) {
    const tail = fb.recentLogs.slice(-6);
    executionPrompt +=
      `\n\n【注意以下日志中的问题】\n` +
      tail.map((l) => `- [${l.level}] ${l.message}`).join("\n");
  }

  return { title, acceptance, executionPrompt, constraints };
}

export function coachChatReplyRules(
  message: string,
  context: CoachChatContext,
): string {
  const m = message.trim().toLowerCase();

  if (/优化|润色|提示词|refine|改一下/.test(m)) {
    return "请在上方输入目标草稿，然后点击「优化提示词」。我会生成标题、验收标准和给 CLI 的执行提示词，你可以在开始前编辑。";
  }

  if (/状态|进展|情况|最近|任务|汇总/.test(m)) {
    const parts: string[] = [];
    if (context.northStar) {
      parts.push(
        `核心目标：「${context.northStar.title}」— ${context.northStar.status}（${context.northStar.progress}%）`,
      );
      if (context.northStar.acceptance) {
        parts.push(`验收：${context.northStar.acceptance}`);
      }
    }
    if (context.subGoals?.length) {
      parts.push(
        "子任务：\n" +
          context.subGoals
            .map(
              (g) =>
                `· ${g.title} [${g.status}] ${g.progress}%${g.resultSummary ? ` — ${g.resultSummary.slice(0, 120)}` : ""}`,
            )
            .join("\n"),
      );
    }
    if (context.goalsSummary && !context.subGoals?.length) {
      parts.push(`任务概况：\n${context.goalsSummary}`);
    }
    if (context.selectedGoal && context.selectedGoal.id !== context.northStar?.id) {
      parts.push(
        `当前选中：「${context.selectedGoal.title}」— ${context.selectedGoal.status}（${context.selectedGoal.progress}%）`,
      );
    }
    if (parts.length > 0) {
      return parts.join("\n\n");
    }
    return "暂无进行中的任务。描述你想达成的核心目标，我会帮你拆解并派发给执行 Agent。";
  }

  if (/验收|标准/.test(m)) {
    return "验收标准应可验证，例如：接口返回 200、测试通过、文档已更新。创建目标时我会根据草稿生成建议，你可手动修改。";
  }

  if (/约束|边界/.test(m)) {
    return "约束可写在草稿中，以「约束：」「禁止：」开头；或在设置中配置全局默认约束，会自动合并进执行提示词。";
  }

  return "我是 OpenX 工头，负责理解你的目标、拆解任务、派发给 Pi 等执行 Agent，并汇总结果。你可以问「最近进展」或描述下一步要做的事。";
}
