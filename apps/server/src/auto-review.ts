/**
 * 自动验收循环（参考 MiMo Compose verify → review → feedback）：
 * 审查员读文件 + 跑测试验证 + 多轮累积上下文 + 父目标精准打回子任务。
 */
import {
  DEFAULT_MAX_ITERATIONS,
  REVIEW_AGENT_ID,
} from "@openx/shared";
import {
  reviewGoalCompletion,
  reviewParentGoalCompletion,
  type ReviewVerdict,
} from "@openx/coach";
import {
  appendLog,
  getConversationById,
  getGoalById,
  getWorkspaceDirForConversation,
  listChildGoals,
  listLogs,
  listReviewRounds,
  updateGoal,
} from "./db.js";
import { resolveCoachAgent } from "./agents-service.js";
import { loadSettings } from "./settings-store.js";
import { resolveMergedLlmContext } from "./llm-context-resolve.js";
import { resolveWorkspaceRoot } from "./workspace-path.js";
import { resolveSystemWorkspaceRoot } from "./system-workspace-path.js";
import { broadcast } from "./sse.js";
import { approveGoal, reworkGoal } from "./goal-actions.js";
import { narrate } from "./narration.js";
import {
  islandForReviewLimit,
  islandForReviewBlocked,
  islandForReviewUnavailable,
  pushIsland,
} from "./island-push.js";
import { recordForemanReviewVerdict } from "./foreman-review.js";
import { routeParentReviewFail } from "./sub-goals.js";
import { buildReviewPacket, recordReviewRound } from "./review-context.js";
import { appendProjectMemorySection } from "./memory-store.js";
import {
  formatVerifyEvidenceBlock,
  runReviewVerification,
  type VerifyCommandResult,
} from "./review-verify.js";

const reviewing = new Set<string>();

function maybeDistillReviewLesson(goalId: string, reason: string): void {
  const goal = getGoalById(goalId);
  if (!goal) return;
  const conversation = getConversationById(goal.conversationId);
  if (!conversation) return;
  const settings = loadSettings();
  const projectDir = getWorkspaceDirForConversation(goal.conversationId);
  const workspaceRoot = resolveWorkspaceRoot(
    projectDir ?? resolveSystemWorkspaceRoot(settings),
  );
  try {
    appendProjectMemorySection(
      workspaceRoot,
      conversation.projectId,
      "审查教训",
      `- 目标「${goal.title}」：${reason.trim().slice(0, 500)}`,
    );
  } catch {
    // 记忆写入失败不阻塞审查主流程
  }
}

function resolveWorkspaceForGoal(conversationId: string): string {
  const settings = loadSettings();
  const projectDir = getWorkspaceDirForConversation(conversationId);
  return resolveWorkspaceRoot(projectDir ?? resolveSystemWorkspaceRoot(settings));
}

function collectVerifyTexts(
  goal: NonNullable<ReturnType<typeof getGoalById>>,
  children: ReturnType<typeof listChildGoals>,
): string[] {
  const texts = [
    goal.acceptance,
    goal.executionPrompt,
    goal.resultSummary ?? "",
    goal.constraints.join("\n"),
  ];
  for (const child of children) {
    texts.push(child.acceptance, child.resultSummary ?? "", child.executionPrompt);
  }
  return texts;
}

function formatReviewFeedback(
  verdict: ReviewVerdict,
  priorRounds: string[],
): string {
  return [
    `【审查未通过 · 第 ${priorRounds.length + 1} 轮】${verdict.reason}`,
    verdict.reworkInstruction
      ? `【修改清单 · 请逐条落实】\n${verdict.reworkInstruction}`
      : "",
    priorRounds.length > 0
      ? `【历史审查记录】\n${priorRounds.join("\n\n")}`
      : "",
    "完成后在结果摘要中列出可验证证据（文件路径、测试输出、API 行为等）。",
  ]
    .filter(Boolean)
    .join("\n\n");
}

type ReviewRunResult = {
  verdict: ReviewVerdict | null;
  llmError?: string;
  isParent: boolean;
  verifyResults: VerifyCommandResult[];
};

async function runReviewVerdict(
  goalId: string,
  iteration: number,
): Promise<ReviewRunResult> {
  const goal = getGoalById(goalId);
  if (!goal) {
    return {
      verdict: null,
      llmError: "目标不存在",
      isParent: false,
      verifyResults: [],
    };
  }

  const settings = loadSettings();
  const workspaceRoot = resolveWorkspaceForGoal(goal.conversationId);
  const priorReviewRounds = listReviewRounds(goalId);
  const packet = buildReviewPacket(goal, workspaceRoot, priorReviewRounds);
  const children = listChildGoals(goalId);

  const verifyResults = runReviewVerification(
    workspaceRoot,
    collectVerifyTexts(goal, children),
  );
  const testEvidence = formatVerifyEvidenceBlock(verifyResults);

  const recentLogs = listLogs(goalId, 20).map((l) => ({
    level: l.level,
    message: l.message,
  }));
  const reviewerRole = resolveCoachAgent(REVIEW_AGENT_ID).rolePrompt;

  if (children.length > 0) {
    const { verdict, llmError } = await reviewParentGoalCompletion(
      {
        parentTitle: goal.title,
        parentAcceptance: goal.acceptance,
        rollupSummary: goal.resultSummary ?? "",
        children: children.map((child) => {
          const childPacket = buildReviewPacket(
            child,
            workspaceRoot,
            listReviewRounds(child.id),
          );
          return {
            title: child.title,
            acceptance: child.acceptance,
            resultSummary: child.resultSummary ?? "",
            fileEvidence: childPacket.fileEvidence,
            deliverablesSummary: childPacket.deliverablesSummary,
          };
        }),
        iteration,
        fileEvidence: packet.fileEvidence,
        testEvidence,
        priorReviewRounds,
        runTrajectory: packet.runTrajectory,
      },
      settings,
      undefined,
      {
        reviewerRolePrompt: reviewerRole,
        llmContextSettings: resolveMergedLlmContext({ goalId: goal.id }),
      },
    );
    return { verdict, llmError, isParent: true, verifyResults };
  }

  const { verdict, llmError } = await reviewGoalCompletion(
    {
      title: goal.title,
      acceptance: goal.acceptance,
      resultSummary: goal.resultSummary ?? "",
      recentLogs,
      iteration,
      deliverablesSummary: packet.deliverablesSummary,
      fileEvidence: packet.fileEvidence,
      testEvidence,
      priorReviewRounds,
      runTrajectory: packet.runTrajectory,
    },
    settings,
    undefined,
    {
      reviewerRolePrompt: reviewerRole,
      llmContextSettings: resolveMergedLlmContext({ goalId: goal.id }),
    },
  );
  return { verdict, llmError, isParent: false, verifyResults };
}

async function executeReviewLoop(
  goalId: string,
  opts?: { ignoreAutoReviewFlag?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  if (reviewing.has(goalId)) {
    return { ok: false, error: "审查正在进行中" };
  }

  const goal = getGoalById(goalId);
  if (!goal) return { ok: false, error: "目标不存在" };
  if (goal.status !== "awaiting_review") {
    return { ok: false, error: "仅「等你确认」状态可触发审查" };
  }
  if (!goal.autoReview && !opts?.ignoreAutoReviewFlag) {
    return { ok: false, error: "该目标未开启自动审查" };
  }

  const iteration = goal.iterationCount ?? 0;
  const maxIterations = goal.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const priorRounds = listReviewRounds(goalId);

  reviewing.add(goalId);
  try {
    const verifyHint =
      "工头验收中…（读文件 + 跑验证命令 + 判定）";
    appendLogAndBroadcast(
      goalId,
      "info",
      `${verifyHint} 第 ${iteration + 1}/${maxIterations} 轮`,
    );
    narrate(`「${goal.title}」工头验收中（第 ${iteration + 1}/${maxIterations} 轮）…`);

    const { verdict, llmError, isParent, verifyResults } = await runReviewVerdict(
      goalId,
      iteration,
    );

    const fresh = getGoalById(goalId);
    if (!fresh || fresh.status !== "awaiting_review") {
      return { ok: false, error: "审查期间目标状态已变更" };
    }

    if (!verdict) {
      appendLogAndBroadcast(
        goalId,
        "warn",
        `审查员不可用（${llmError ?? "未知原因"}），请人工确认`,
      );
      const latest = getGoalById(goalId);
      if (latest) {
        pushIsland(islandForReviewUnavailable(latest, llmError));
      }
      return { ok: false, error: llmError ?? "审查员不可用" };
    }

    recordReviewRound(goalId, iteration, verdict, verifyResults);
    recordForemanReviewVerdict(goalId, verdict, {
      iteration: iteration + 1,
      verifySummary: formatVerifyEvidenceBlock(verifyResults),
    });

    if (verdict.blocked) {
      appendLogAndBroadcast(
        goalId,
        "warn",
        `审查员判定目标不可达：${verdict.reason}`,
      );
      narrate(`「${goal.title}」审查员判定不可达，请人工处理。`);
      const latest = getGoalById(goalId);
      if (latest) {
        pushIsland(islandForReviewBlocked(latest, verdict.reason));
      }
      return { ok: false, error: "审查员判定目标不可达" };
    }

    if (verdict.verdict === "pass") {
      const label = isParent ? "合成验收通过" : "自动验收通过";
      appendLogAndBroadcast(goalId, "info", `${label}：${verdict.reason}`);
      narrate(`「${goal.title}」${label}，已标记完成。`);
      approveGoal(goalId, { source: "auto" });
      return { ok: true };
    }

    if (iteration + 1 >= maxIterations) {
      appendLogAndBroadcast(
        goalId,
        "warn",
        `审查未通过且已达迭代上限（${maxIterations} 轮），请人工处理。原因：${verdict.reason}`,
      );
      narrate(`「${goal.title}」审查未通过且已达 ${maxIterations} 轮上限，请人工确认。`);
      const latest = getGoalById(goalId);
      if (latest) {
        pushIsland(
          islandForReviewLimit(latest, verdict.reason, iteration + 1),
        );
      }
      return { ok: false, error: "已达迭代上限，请人工介入" };
    }

    if (isParent) {
      fresh.iterationCount = iteration + 1;
      fresh.updatedAt = new Date().toISOString();
      updateGoal(fresh);
      broadcast({ type: "goal.updated", goal: fresh });
      await routeParentReviewFail(goalId, verdict);
      appendLogAndBroadcast(
        goalId,
        "warn",
        `父目标合成验收未通过：${verdict.reason}`,
      );
      narrate(
        `「${goal.title}」合成验收未通过：${verdict.reason.slice(0, 80)}`,
      );
      return { ok: true };
    }

    const reworkReason = formatReviewFeedback(verdict, priorRounds);
    maybeDistillReviewLesson(goalId, verdict.reason);
    void import("./dream-job.js").then(({ distillMemoryForConversation }) => {
      const goal = getGoalById(goalId);
      if (goal) distillMemoryForConversation(goal.conversationId);
    });
    narrate(`「${goal.title}」审查未通过，ACP steer 返工：${verdict.reason.slice(0, 80)}`);
    await reworkGoal(goalId, reworkReason, { source: "auto" });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    appendLogAndBroadcast(goalId, "error", `自动验收异常：${message}`);
    return { ok: false, error: message };
  } finally {
    reviewing.delete(goalId);
  }
}

export async function maybeAutoReview(goalId: string): Promise<void> {
  await executeReviewLoop(goalId);
}

/** 人工触发审查（即使未开 autoReview 也可 force） */
export async function triggerGoalReview(
  goalId: string,
  opts?: { force?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  return executeReviewLoop(goalId, {
    ignoreAutoReviewFlag: opts?.force ?? false,
  });
}

function appendLogAndBroadcast(
  goalId: string,
  level: "info" | "warn" | "error",
  message: string,
): void {
  const log = appendLog(goalId, level, message);
  broadcast({ type: "log.append", goalId, ...log });
}

/** 测试用 */
export function resetAutoReview(): void {
  reviewing.clear();
}
