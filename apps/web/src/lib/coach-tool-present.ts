/** 工头 XML 工具块结构化摘要（流式阶段可读，不必等落库卡片） */

export type CoachToolSummary = {
  headline: string;
  details: string[];
  incomplete: boolean;
};

function extractJsonObject(raw: string): unknown | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  try {
    return JSON.parse(raw.slice(start)) as unknown;
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function clip(text: string, max = 120): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function summarizeCoachTool(
  toolName: string,
  payload: string,
  incomplete = false,
): CoachToolSummary {
  const parsed = extractJsonObject(payload);
  const root = asRecord(parsed);

  if (toolName === "propose_work_order") {
    const refined = asRecord(root?.refined) ?? root;
    const title =
      (typeof refined?.title === "string" && refined.title) ||
      (typeof root?.title === "string" && root.title) ||
      "任务单";
    const acceptance =
      typeof refined?.acceptance === "string" ? refined.acceptance : "";
    const prompt =
      typeof refined?.executionPrompt === "string" ? refined.executionPrompt : "";
    const subGoals = Array.isArray(refined?.subGoals) ? refined.subGoals.length : 0;
    const details: string[] = [];
    if (acceptance) details.push(`验收：${clip(acceptance)}`);
    if (prompt) details.push(`执行：${clip(prompt, 80)}`);
    if (subGoals > 0) details.push(`子任务：${subGoals} 项`);
    return { headline: title, details, incomplete };
  }

  if (toolName === "knowledge_save") {
    const title = typeof root?.title === "string" ? root.title : "知识条目";
    const content = typeof root?.content === "string" ? root.content : "";
    const details: string[] = [];
    if (content) details.push(clip(content, 100));
    return { headline: `保存知识：${title}`, details, incomplete };
  }

  if (toolName === "propose_clarification") {
    const clarify = asRecord(root?.clarify) ?? root;
    const title =
      (typeof clarify?.title === "string" && clarify.title) ||
      "澄清问题";
    const questions = Array.isArray(clarify?.questions) ? clarify.questions : [];
    const details: string[] = [];
    if (questions.length > 0) {
      details.push(`共 ${questions.length} 题`);
      const first = asRecord(questions[0]);
      if (typeof first?.prompt === "string") {
        details.push(clip(first.prompt, 100));
      }
    }
    return { headline: title, details, incomplete };
  }

  return {
    headline: toolName,
    details: payload.trim() ? [clip(payload, 200)] : [],
    incomplete,
  };
}
