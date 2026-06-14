import type { RefinedGoal, RefinedSubGoal } from "./coach.js";
import {
  buildBriefExecutionPrompt,
  type BriefTemplateSection,
  DEFAULT_BRIEF_TEMPLATE_SECTIONS,
} from "./brief-template.js";

/** 是否像 bug / 表现异常类问题描述 */
export function isBugOrAnomalyReport(text: string): boolean {
  const m = text.trim();
  if (!m) return false;
  return /bug|缺陷|报错|异常|不对|没反应|失败|崩溃|crash|broken|fix|修复|表现|出错|无法|不能用|白屏|卡死|超时|500|404|undefined|null/i.test(
    m,
  );
}

function isReconSubGoal(sub: RefinedSubGoal): boolean {
  const blob = `${sub.title}\n${sub.executionPrompt}`;
  return /侦察|调查|只读|Explore|排查|定位|证据|根因分析/i.test(blob);
}

/** 是否需强制两阶段 subGoals（侦察 → 修复） */
export function shouldEnforceBugTwoPhase(
  refined: RefinedGoal,
  sourceText: string,
): boolean {
  if (!isBugOrAnomalyReport(sourceText)) return false;
  const subs = refined.subGoals ?? [];
  if (subs.length >= 2 && isReconSubGoal(subs[0]!)) return false;
  return true;
}

function reconBrief(
  parent: RefinedGoal,
  sourceText: string,
  sections: BriefTemplateSection[],
): string {
  return buildBriefExecutionPrompt(sections, {
    issueType: "只读侦察",
    userExpectation: "收集可验证证据，定位根因或排除假设",
    actualPhenomenon: sourceText.trim(),
    knownFacts: parent.executionPrompt.includes("【")
      ? "见父任务 brief"
      : parent.executionPrompt.trim() || sourceText.trim(),
    toVerify: [
      "复现路径与日志/报错证据",
      "相关代码、配置、测试现状",
      "正常路径 vs 异常路径的分叉点",
      "根因假设与支持/反驳证据",
    ].join("\n- "),
    investigationEntry: "从用户描述与父任务 brief 中提取的关键词、路径、接口名",
    scopeBoundary: "只读调查，不修改代码或配置；不部署",
    steps: [
      "1. 按调查入口阅读相关代码/配置/日志",
      "2. 尝试复现并记录证据（命令输出、报错、Network 等）",
      "3. 列出根因假设及支持证据",
      "4. 输出结构化侦察报告供阶段二使用",
    ].join("\n"),
    acceptanceCriteria:
      "输出侦察报告：复现结论、关键证据、根因判断（或待确认项）、建议修复方向",
    constraints: "禁止修改、删除、创建文件；禁止安装依赖",
  });
}

function fixBrief(
  parent: RefinedGoal,
  sourceText: string,
  sections: BriefTemplateSection[],
): string {
  return buildBriefExecutionPrompt(sections, {
    issueType: "bug 修复",
    userExpectation: parent.acceptance.trim() || "修复用户报告的问题并通过验证",
    actualPhenomenon: sourceText.trim(),
    knownFacts: "阶段一侦察报告中的证据与根因结论（必须先完成阶段一）",
    toVerify: "修复后回归测试通过；无引入新问题",
    investigationEntry: "阶段一报告指明的文件/模块/接口",
    scopeBoundary: "仅修复已定位问题；不做无关重构",
    steps: [
      "1. 阅读阶段一侦察报告，确认根因",
      "2. 在范围边界内实施最小修复",
      "3. 运行相关测试或验证命令",
      "4. 输出修复摘要与验证证据",
    ].join("\n"),
    acceptanceCriteria:
      parent.acceptance.trim() ||
      "问题已修复；相关测试/验证通过；结果摘要含修改文件与验证输出",
    constraints: [
      ...(parent.constraints ?? []),
      "最小改动；遵循项目现有风格",
    ].join("\n"),
  });
}

/**
 * bug/异常类强制两阶段 subGoals：①只读侦察 ②修复验证。
 * 父级 refined 保留为总览 brief。
 */
export function enforceBugTwoPhaseSubGoals(
  refined: RefinedGoal,
  sourceText: string,
  sections: BriefTemplateSection[] = DEFAULT_BRIEF_TEMPLATE_SECTIONS,
): RefinedGoal {
  if (!shouldEnforceBugTwoPhase(refined, sourceText)) return refined;

  const titleBase = refined.title.trim() || "Bug 排查与修复";
  const recon: RefinedSubGoal = {
    title: `阶段一：只读侦察 · ${titleBase}`,
    acceptance:
      "提交侦察报告：复现结论、关键证据（路径/日志/命令输出）、根因判断或待确认项、建议修复方向",
    executionPrompt: reconBrief(refined, sourceText, sections),
    constraints: ["只读操作", "不修改任何文件"],
    executorId: refined.executorId,
    agentId: refined.agentId,
    mcpIds: refined.mcpIds,
    skillIds: refined.skillIds,
    permissionMode: "read_only",
  };

  const fix: RefinedSubGoal = {
    title: `阶段二：修复与验证 · ${titleBase}`,
    acceptance:
      refined.acceptance.trim() ||
      "问题已修复；验证通过；摘要列出修改文件与测试/命令输出",
    executionPrompt: fixBrief(refined, sourceText, sections),
    constraints: refined.constraints,
    executorId: refined.executorId,
    agentId: refined.agentId,
    mcpIds: refined.mcpIds,
    skillIds: refined.skillIds,
    dependsOnIndex: [0],
  };

  return {
    ...refined,
    title: titleBase,
    acceptance: `两阶段完成：①侦察证据充分 ②修复并通过验证。${refined.acceptance}`.trim(),
    executionPrompt: buildBriefExecutionPrompt(sections, {
      issueType: "bug（两阶段派单）",
      userExpectation: refined.acceptance || "修复用户报告的问题",
      actualPhenomenon: sourceText.trim(),
      knownFacts: refined.executionPrompt.trim() || sourceText.trim(),
      toVerify: "由阶段一侦察；阶段二修复验证",
      scopeBoundary: "见 subGoals：先侦察后修复，顺序不可跳过",
      steps: "1. 执行阶段一（只读侦察）\n2. 执行阶段二（修复与验证）",
      acceptanceCriteria: refined.acceptance,
      constraints: refined.constraints.join("\n"),
    }),
    subGoals: [recon, fix],
  };
}
