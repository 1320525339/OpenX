export type ReviewPlaybookStep = {
  id: string;
  title: string;
  summary: string;
  checks?: string[];
};

export type ReviewPlaybookFlow = {
  id: string;
  title: string;
  description: string;
  steps: ReviewPlaybookStep[];
};

export type ReviewPlaybook = {
  version: string;
  product: string;
  flows: ReviewPlaybookFlow[];
};

export function buildReviewPlaybook(): ReviewPlaybook {
  return {
    version: "0.1.0",
    product: "OpenX",
    flows: [
      {
        id: "goal_review",
        title: "单目标自动验收",
        description:
          "执行器标记完成后，对照 acceptance 与工作区证据判定 pass/fail，fail 时输出可执行返工清单。",
        steps: [
          {
            id: "gather_evidence",
            title: "收集证据",
            summary: "读取 resultSummary、deliverables、近期日志、工作区文件与验证命令输出。",
            checks: [
              "结果摘要是否列出可验证产出（路径、命令输出、链接）",
              "日志中是否有测试/构建失败或未完成任务",
            ],
          },
          {
            id: "map_acceptance",
            title: "逐条映射验收标准",
            summary: "将 acceptance 每条与证据一一对照；未在证据中出现的内容视为未完成。",
            checks: [
              "每条验收标准都有对应证据",
              "执行器自称完成但无产出 → fail",
            ],
          },
          {
            id: "verdict",
            title: "输出判定",
            summary: "全部达标 → pass；否则 fail，并在 reworkInstruction 中给出编号问题清单。",
            checks: [
              "宁可 fail 也不要「差不多」放行",
              "reworkInstruction 须逐条可执行、可验证",
            ],
          },
        ],
      },
      {
        id: "parent_review",
        title: "父目标合成验收",
        description:
          "各子任务 individually 完成后，判断集成后父目标 acceptance 是否真正达成。",
        steps: [
          {
            id: "rollup_input",
            title: "阅读父汇总与子任务结果",
            summary: "结合父目标 acceptance、rollup 摘要与各子任务 resultSummary。",
          },
          {
            id: "integration_gaps",
            title: "检查集成缺口",
            summary: "子任务之间是否有矛盾、遗漏接口或未覆盖的集成点。",
            checks: [
              "子任务各自 pass ≠ 父目标集成 pass",
              "跨子任务的端到端行为须在证据中体现",
            ],
          },
          {
            id: "parent_verdict",
            title: "合成判定",
            summary:
              "pass 或 fail；fail 时填写 reworkTargets（childTitle 与子任务 title 完全一致）。",
          },
        ],
      },
      {
        id: "rollup",
        title: "父目标汇总",
        description: "子任务全部完成后，整合为父目标验收摘要供用户与合成验收使用。",
        steps: [
          {
            id: "collect_child_results",
            title: "汇总子任务要点",
            summary: "提取各子任务关键事实：文件、API、数据、命令输出，不臆造。",
          },
          {
            id: "integration_narrative",
            title: "描述衔接关系",
            summary: "说明子任务如何拼成整体、整体完成度与剩余风险。",
          },
          {
            id: "markdown_output",
            title: "输出 Markdown 摘要",
            summary: "中文、结构清晰，800 字以内，仅正文无 JSON。",
          },
        ],
      },
    ],
  };
}

export function findReviewPlaybookFlow(
  playbook: ReviewPlaybook,
  flowId: string,
): ReviewPlaybookFlow | undefined {
  return playbook.flows.find((f) => f.id === flowId);
}

/** 将指定流程格式化为可注入 system prompt 的 Markdown 块 */
export function formatReviewPlaybookFlow(
  playbook: ReviewPlaybook,
  flowId: string,
): string {
  const flow = findReviewPlaybookFlow(playbook, flowId);
  if (!flow) return "";

  const stepLines = flow.steps.map((step, i) => {
    const checks =
      step.checks?.length ?
        `\n   - ${step.checks.join("\n   - ")}`
      : "";
    return `${i + 1}. **${step.title}** — ${step.summary}${checks}`;
  });

  return [
    `# 验收流程 Playbook：${flow.title}`,
    flow.description,
    "",
    ...stepLines,
  ].join("\n");
}

/** 在已有 system prompt 后追加 Playbook 流程说明 */
export function appendReviewPlaybookToSystem(
  system: string,
  flowId: string,
  playbook: ReviewPlaybook = buildReviewPlaybook(),
): string {
  const block = formatReviewPlaybookFlow(playbook, flowId);
  if (!block.trim()) return system;
  return `${system.trim()}\n\n${block}`;
}
