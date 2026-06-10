import type { CoachGoalBrief } from "@openx/shared";

export type NextStepsTrigger = "approve" | "rework";

export function buildNextStepsUserMessage(
  focusGoal: CoachGoalBrief & { reworkReason?: string },
  northStar: CoachGoalBrief,
  siblings: CoachGoalBrief[],
  trigger: NextStepsTrigger,
): string {
  const siblingLines =
    siblings.length > 0
      ? siblings
          .map(
            (s) =>
              `- ${s.title} [${s.status}]${s.resultSummary ? ` — ${s.resultSummary}` : ""}`,
          )
          .join("\n")
      : "（尚无其他子任务）";

  if (trigger === "rework") {
    return `【系统自动触发 · 返工规划】
子任务「${focusGoal.title}」已返工并重新执行。
返工原因：${focusGoal.reworkReason?.trim() || "（未填写）"}

核心目标：${northStar.title}
验收：${northStar.acceptance ?? "（未设）"}

已有子任务：
${siblingLines}

请判断是否需要新增辅助子任务（填入 refined.subGoals，每项含 title、acceptance、executionPrompt）。
若只需当前任务返工、不需新子任务，则只回复 message，不要填 subGoals。`;
  }

  return `【系统自动触发 · 验收通过】
子任务「${focusGoal.title}」已通过验收。
结果摘要：${focusGoal.resultSummary ?? "（无）"}

核心目标：${northStar.title}
验收：${northStar.acceptance ?? "（未设）"}

已有子任务：
${siblingLines}

请对照核心目标 acceptance，判断是否还需更多子任务。
若需要，在 refined.subGoals 中给出下一批子任务（每项含 title、acceptance、executionPrompt、可选 executorId）。
若核心目标已达成或无需新子任务，只回复 message，不要填 subGoals。`;
}
