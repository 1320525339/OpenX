import { nanoid } from "nanoid";
import {
  buildNextStepsUserMessage,
  coachChatReply,
  refineGoal,
} from "@openx/coach";
import {
  DEFAULT_AUTO_REVIEW,
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
import { buildGoalDispatchContext } from "./goal-dispatch.js";
import { claimGoalForDispatch } from "./goal-lifecycle.js";

export function refinedSubGoalsToInput(subs: RefinedSubGoal[]): SubGoalInput[] {
  return subs.map((sg) => ({
    userDraft: sg.executionPrompt,
    title: sg.title,
    acceptance: sg.acceptance,
    executionPrompt: sg.executionPrompt,
    constraints: sg.constraints,
    executorId: sg.executorId ?? "pi",
    priority: sg.priority,
    agentId: sg.agentId,
    mcpIds: sg.mcpIds,
    skillIds: sg.skillIds,
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
  if (!areDependenciesMet(goal)) return;
  const claimed = claimGoalForDispatch(goal.id, ["draft"]);
  if (!claimed) return;
  claimed.progress = 0;
  claimed.updatedAt = new Date().toISOString();
  updateGoal(claimed);
  broadcast({ type: "goal.updated", goal: claimed });
  appendLog(claimed.id, "info", `任务启动，执行器：${claimed.executorId}`);
  void dispatchGoal(claimed.id);
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
      conversationId: parent.conversationId,
      title: sub.title ?? subRefined.title,
      acceptance: sub.acceptance ?? subRefined.acceptance,
      userDraft: sub.userDraft,
      executionPrompt: sub.executionPrompt ?? subRefined.executionPrompt,
      constraints: sub.constraints ?? subRefined.constraints,
      executorId: sub.executorId ?? settings.defaultExecutorId,
      parentGoalId: parentId,
      dependsOn: sub.dependsOn ?? (children.length === 0 ? [] : [chainPrevId]),
      priority: sub.priority ?? "medium",
      autoReview: parent.autoReview ?? DEFAULT_AUTO_REVIEW,
      maxIterations: parent.maxIterations,
      iterationCount: 0,
      dispatchContext: buildGoalDispatchContext(sub, undefined, parent),
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

function matchChildByTitle(children: Goal[], title: string): Goal | undefined {
  const norm = title.trim().toLowerCase();
  const exact = children.find((c) => c.title.trim().toLowerCase() === norm);
  if (exact) return exact;
  return children.find(
    (c) =>
      c.title.toLowerCase().includes(norm) || norm.includes(c.title.toLowerCase()),
  );
}

function resetParentAfterReviewFail(parent: Goal): void {
  if (parent.status !== "awaiting_review") return;
  parent.status = "draft";
  parent.progress = Math.min(parent.progress, 90);
  parent.updatedAt = new Date().toISOString();
  updateGoal(parent);
  broadcast({ type: "goal.updated", goal: parent });
}

/** 父目标合成验收 fail：优先精准打回子任务，否则创建修补子任务 */
export async function routeParentReviewFail(
  parentId: string,
  verdict: import("@openx/coach").ReviewVerdict,
): Promise<Goal[]> {
  const parent = getGoalById(parentId);
  if (!parent) return [];

  const children = listChildGoals(parentId);
  const targets =
    verdict.reworkTargets?.filter((t) => t.childTitle?.trim() && t.instruction?.trim()) ??
    [];

  const reopened: Goal[] = [];
  for (const target of targets) {
    const child = matchChildByTitle(children, target.childTitle);
    if (!child || child.status !== "done") continue;
    const { reopenChildGoalForReview } = await import("./goal-actions.js");
    const ok = await reopenChildGoalForReview(child.id, parent, target.instruction, verdict.reason);
    if (ok) {
      const updated = getGoalById(child.id);
      if (updated) reopened.push(updated);
    }
  }

  if (reopened.length > 0) {
    resetParentAfterReviewFail(parent);
    appendLog(
      parentId,
      "warn",
      `父目标合成验收未通过，已打回 ${reopened.length} 个子任务：${reopened.map((g) => g.title).join("、")}`,
    );
    return reopened;
  }

  return spawnReviewFixSubGoals(parentId, verdict.reason, verdict.reworkInstruction);
}

/** 父目标合成验收未通过：创建修补子任务并自动启动（compose:feedback 闭环） */
export function spawnReviewFixSubGoals(
  parentId: string,
  reason: string,
  reworkInstruction?: string,
): Goal[] {
  const parent = getGoalById(parentId);
  if (!parent) return [];

  const settings = loadSettings();
  const instruction = reworkInstruction?.trim() || reason;
  const now = new Date().toISOString();
  const fix: Goal = {
    id: nanoid(),
    conversationId: parent.conversationId,
    title: `修补 · ${parent.title}`.slice(0, 120),
    acceptance: instruction,
    userDraft: `审查员指出父目标未完全达标：${reason}`,
    executionPrompt: [
      `父目标「${parent.title}」合成验收未通过。`,
      `问题：${reason}`,
      reworkInstruction ? `修改清单：\n${reworkInstruction}` : "",
      "请修复并提交可验证证据（文件路径、测试输出等）。",
    ]
      .filter(Boolean)
      .join("\n\n"),
    constraints: parent.constraints,
    executorId:
      parent.executorId === "auto" ? settings.defaultExecutorId : parent.executorId,
    parentGoalId: parentId,
    dependsOn: [],
    priority: parent.priority,
    autoReview: parent.autoReview ?? DEFAULT_AUTO_REVIEW,
    maxIterations: parent.maxIterations,
    iterationCount: 0,
    dispatchContext: parent.dispatchContext,
    status: "draft",
    progress: 0,
    createdAt: now,
    updatedAt: now,
  };
  insertGoal(fix);
  broadcast({ type: "goal.updated", goal: fix });
  appendLog(
    parentId,
    "warn",
    `父目标合成验收未通过，已创建修补子任务「${fix.title}」`,
  );

  resetParentAfterReviewFail(parent);

  startRunnableDraft(fix);
  return [fix];
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
  const context = buildCoachChatContext(focus.conversationId, focusGoalId);
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
