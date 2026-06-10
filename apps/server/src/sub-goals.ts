import { nanoid } from "nanoid";
import {
  buildNextStepsUserMessage,
  coachChatReply,
  refineGoal,
} from "@openx/coach";
import {
  canTransition,
  type Goal,
  type RefinedSubGoal,
  type SubGoalInput,
} from "@openx/shared";
import {
  buildCoachChatContext,
  resolveNorthStarGoal,
} from "./coach-context.js";
import {
  appendLog,
  areDependenciesMet,
  getGoalById,
  insertGoal,
  listChildGoals,
  updateGoal,
} from "./db.js";
import { dispatchGoal, tryDispatchDependents } from "./orchestrator.js";
import { loadSettings } from "./settings-store.js";
import { broadcast } from "./sse.js";

export function refinedSubGoalsToInput(subs: RefinedSubGoal[]): SubGoalInput[] {
  return subs.map((sg) => ({
    userDraft: sg.executionPrompt,
    title: sg.title,
    acceptance: sg.acceptance,
    executionPrompt: sg.executionPrompt,
    constraints: sg.constraints,
    executorId: sg.executorId ?? "pi",
    priority: sg.priority,
  }));
}

function resolveChainAnchor(parentId: string): string {
  const existingChildren = listChildGoals(parentId);
  const completed = existingChildren.filter((g) => g.status === "done");
  if (completed.length > 0) {
    return completed[completed.length - 1]!.id;
  }
  if (existingChildren.length > 0) {
    const sorted = [...existingChildren].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    return sorted[sorted.length - 1]!.id;
  }
  return parentId;
}

function startRunnableDraft(goal: Goal): void {
  if (!canTransition(goal.status, "running")) return;
  if (!areDependenciesMet(goal)) return;
  goal.status = "running";
  goal.progress = 0;
  goal.updatedAt = new Date().toISOString();
  updateGoal(goal);
  broadcast({ type: "goal.updated", goal });
  appendLog(goal.id, "info", `任务启动，执行器：${goal.executorId}`);
  void dispatchGoal(goal.id);
}

export async function createSubGoalsUnderParent(
  parentId: string,
  subGoalsInput: SubGoalInput[],
  autoStart?: boolean,
): Promise<Goal[]> {
  const parent = getGoalById(parentId);
  if (!parent) throw new Error("Parent goal not found");

  const settings = loadSettings();
  let chainPrevId = resolveChainAnchor(parentId);
  const children: Goal[] = [];

  for (const sub of subGoalsInput) {
    const { refined: subRefined } = await refineGoal(
      { userDraft: sub.userDraft, constraints: sub.constraints },
      settings,
      settings.defaultConstraints,
    );
    const childNow = new Date().toISOString();
    const child: Goal = {
      id: nanoid(),
      title: sub.title ?? subRefined.title,
      acceptance: sub.acceptance ?? subRefined.acceptance,
      userDraft: sub.userDraft,
      executionPrompt: sub.executionPrompt ?? subRefined.executionPrompt,
      constraints: sub.constraints ?? subRefined.constraints,
      executorId: sub.executorId ?? settings.defaultExecutorId,
      parentGoalId: parentId,
      dependsOn: sub.dependsOn ?? [chainPrevId],
      priority: sub.priority ?? "medium",
      status: "draft",
      progress: 0,
      createdAt: childNow,
      updatedAt: childNow,
    };
    insertGoal(child);
    broadcast({ type: "goal.updated", goal: child });
    children.push(child);
    chainPrevId = child.id;
  }

  const shouldStart = autoStart ?? settings.autoExecute;
  if (shouldStart) {
    for (const child of children) {
      startRunnableDraft(child);
    }
  }

  return children;
}

function hasActiveSiblingDrafts(
  siblings: Goal[],
  excludeId: string,
): boolean {
  return siblings.some(
    (g) =>
      g.id !== excludeId &&
      (g.status === "draft" ||
        g.status === "running" ||
        g.status === "awaiting_review"),
  );
}

export async function autoDraftNextSubGoals(
  focusGoalId: string,
  trigger: "approve" | "rework" = "approve",
): Promise<Goal[]> {
  const focus = getGoalById(focusGoalId);
  if (!focus) return [];

  const northStar = resolveNorthStarGoal(focusGoalId);
  if (!northStar) return [];

  if (!focus.parentGoalId && trigger === "approve") return [];

  const siblings = listChildGoals(northStar.id);

  if (hasActiveSiblingDrafts(siblings, focusGoalId)) return [];

  const settings = loadSettings();
  const context = buildCoachChatContext(focusGoalId);
  const siblingBriefs = siblings.map((g) => ({
    id: g.id,
    title: g.title,
    status: g.status,
    progress: g.progress,
    executorId: g.executorId,
    acceptance: g.acceptance,
    resultSummary: g.resultSummary,
  }));

  const syntheticMessage = buildNextStepsUserMessage(
    {
      id: focus.id,
      title: focus.title,
      status: focus.status,
      progress: focus.progress,
      executorId: focus.executorId,
      acceptance: focus.acceptance,
      resultSummary: focus.resultSummary,
      reworkReason: focus.reworkReason,
    },
    {
      id: northStar.id,
      title: northStar.title,
      status: northStar.status,
      progress: northStar.progress,
      executorId: northStar.executorId,
      acceptance: northStar.acceptance,
      resultSummary: northStar.resultSummary,
    },
    siblingBriefs,
    trigger,
  );

  try {
    const { refined } = await coachChatReply(
      syntheticMessage,
      context,
      settings,
      settings.defaultConstraints,
    );
    if (!refined?.subGoals?.length) return [];

    const existingTitles = new Set(
      siblings.map((s) => s.title.trim().toLowerCase()),
    );
    const novel = refined.subGoals.filter(
      (sg) => !existingTitles.has(sg.title.trim().toLowerCase()),
    );
    if (novel.length === 0) return [];

    const children = await createSubGoalsUnderParent(
      northStar.id,
      refinedSubGoalsToInput(novel),
      settings.autoExecute,
    );

    if (children.length > 0) {
      appendLog(
        northStar.id,
        "info",
        `Coach 自动规划 ${children.length} 个下一批子任务`,
      );
      tryDispatchDependents(focusGoalId);
    }

    return children;
  } catch (err) {
    console.warn("[coach] autoDraftNextSubGoals failed:", err);
    return [];
  }
}
