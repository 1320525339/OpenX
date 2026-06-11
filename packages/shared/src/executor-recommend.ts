export type GoalIntent = "web" | "local" | "git" | "general";

export type ExecutorCandidateScore = {
  executorId: string;
  score: number;
  enabledSkillIds: string[];
};

export type ExecutorRecommendation = {
  executorId: string;
  reason: string;
  intent: GoalIntent;
  scores: ExecutorCandidateScore[];
};

const WEB_PATTERNS =
  /抓取|爬取|爬站|网页|url|http|https|obscura|scrape|fetch|crawl|网站|页面内容/i;
const GIT_PATTERNS = /git|commit|diff|branch|提交|分支|merge|rebase/i;
const LOCAL_PATTERNS =
  /文件|目录|代码|运行|命令|shell|ls\b|dir\b|workspace|工作区|读写|编译|构建/i;

export function detectGoalIntent(text: string): GoalIntent {
  const t = text.trim();
  if (!t) return "general";
  if (WEB_PATTERNS.test(t)) return "web";
  if (GIT_PATTERNS.test(t)) return "git";
  if (LOCAL_PATTERNS.test(t)) return "local";
  return "general";
}

export function collectGoalIntentText(parts: {
  title?: string;
  acceptance?: string;
  executionPrompt?: string;
  userDraft?: string;
}): string {
  return [parts.title, parts.acceptance, parts.executionPrompt, parts.userDraft]
    .filter(Boolean)
    .join("\n");
}

function hasObscuraSkill(skillIds: string[]): boolean {
  return skillIds.some((id) => id.startsWith("obscura-"));
}

function isPiExecutor(executorId: string): boolean {
  return executorId === "pi";
}

function isAcpExecutor(executorId: string): boolean {
  return executorId.startsWith("acp:");
}

function isConnectExecutor(executorId: string): boolean {
  return !isAcpExecutor(executorId) && executorId !== "pi" && executorId !== "auto";
}

/**
 * 执行器打分（已去 Pi 偏置）：
 * - ACP CLI（Codex/Claude/Gemini）是成熟 Coding Agent，本地/代码/Git 任务与 Pi 同档竞争
 * - Pi 仅保留轻微的工头本地优势（同分时由排序的 pi 优先规则兜底）
 */
export function scoreExecutorForGoal(params: {
  executorId: string;
  available: boolean;
  intent: GoalIntent;
  enabledSkillIds: string[];
}): number {
  const { executorId, available, intent, enabledSkillIds } = params;
  if (!available) return -1;

  let score = 0;

  if (intent === "web") {
    if (hasObscuraSkill(enabledSkillIds)) score += 10;
    if (isPiExecutor(executorId) && enabledSkillIds.some((id) => id === "filesystem" || id === "shell")) {
      score += 3;
    }
    if (isAcpExecutor(executorId)) score += 2;
    if (isConnectExecutor(executorId) && hasObscuraSkill(enabledSkillIds)) score += 2;
  } else if (intent === "local") {
    if (isPiExecutor(executorId)) score += 5;
    if (isAcpExecutor(executorId)) score += 5;
    if (enabledSkillIds.includes("filesystem") || enabledSkillIds.includes("shell")) score += 2;
    if (isConnectExecutor(executorId)) score -= 2;
  } else if (intent === "git") {
    if (isPiExecutor(executorId)) score += 4;
    if (isAcpExecutor(executorId)) score += 5;
    if (enabledSkillIds.includes("git")) score += 4;
  } else {
    if (isPiExecutor(executorId)) score += 4;
    if (isAcpExecutor(executorId)) score += 3;
    if (enabledSkillIds.length > 0) score += 1;
  }

  if (isConnectExecutor(executorId) && available) score += 1;
  if (isAcpExecutor(executorId) && available) score += 1;

  return score;
}

export function recommendExecutorId(
  candidates: Array<{ executorId: string; available: boolean; enabledSkillIds: string[] }>,
  intent: GoalIntent,
): ExecutorRecommendation | null {
  const scored: ExecutorCandidateScore[] = candidates
    .map((c) => ({
      executorId: c.executorId,
      enabledSkillIds: c.enabledSkillIds,
      score: scoreExecutorForGoal({
        executorId: c.executorId,
        available: c.available,
        intent,
        enabledSkillIds: c.enabledSkillIds,
      }),
    }))
    .filter((c) => c.score >= 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.executorId === "pi") return -1;
      if (b.executorId === "pi") return 1;
      return a.executorId.localeCompare(b.executorId);
    });

  if (scored.length === 0) return null;

  const winner = scored[0];
  const reason = buildRecommendReason(winner, intent, scored);

  return {
    executorId: winner.executorId,
    reason,
    intent,
    scores: scored,
  };
}

function buildRecommendReason(
  winner: ExecutorCandidateScore,
  intent: GoalIntent,
  all: ExecutorCandidateScore[],
): string {
  const parts: string[] = [];
  if (intent === "web" && hasObscuraSkill(winner.enabledSkillIds)) {
    parts.push("任务涉及网页抓取，该执行器已启用 Obscura Skills");
  } else if (intent === "local" && winner.executorId === "pi") {
    parts.push("本地文件/代码任务，优先 Pi 内嵌底座");
  } else if (intent === "git") {
    parts.push("Git 相关任务，推荐具备 Git 能力的执行器");
  } else if (winner.enabledSkillIds.length > 0) {
    parts.push(`已配置 Skills：${winner.enabledSkillIds.slice(0, 3).join("、")}`);
  } else {
    parts.push("按可用性与默认策略推荐");
  }

  if (all.length > 1 && all[1].score === winner.score) {
    parts.push("（与备选得分相同，已按 pi 优先规则选择）");
  }

  return parts.join("；");
}

/** 规则引擎胜出阈值：领先第二名 ≥5 分则跳过 LLM 路由 */
export function isClearRuleWinner(recommendation: ExecutorRecommendation): boolean {
  if (recommendation.scores.length < 2) return true;
  return recommendation.scores[0].score - recommendation.scores[1].score >= 5;
}
