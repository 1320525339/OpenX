/**

 * 父目标自动验收（子任务 rollup）

 *

 * 参考 OpenHands 等多 Agent 框架：子 Agent 完成后由父层汇总结果并进入验收，

 * 而非要求父目标自身再跑一遍执行器。

 */

import { synthesizeParentRollupSummary } from "@openx/coach";

import { canTransition, type Goal } from "@openx/shared";
import { isChildGoalComplete } from "@openx/shared";

import {

  appendLog,

  getGoalById,

  listChildGoals,

  updateGoal,

} from "./db.js";

import { markGoalComplete } from "./goal-lifecycle.js";

import { cancelRunning } from "./orchestrator.js";

import { broadcast } from "./sse.js";

import { loadSettings } from "./settings-store.js";
import { resolveMergedLlmContext } from "./llm-context-resolve.js";



export function buildParentRollupSummary(parent: Goal, children: Goal[]): string {

  const blocks = [

    `【子任务汇总】父目标「${parent.title}」下 ${children.length} 项子任务已全部完成。`,

    ...children.map((child, index) => {

      const summary = child.resultSummary?.trim() || "（执行器未提供结果摘要）";

      return `### ${index + 1}. ${child.title}\n${summary}`;

    }),

  ];

  return blocks.join("\n\n");

}



function mergeRollupSummary(

  existing: string | undefined,

  rollup: string,

): string {

  if (!existing?.trim()) return rollup;

  return `${existing.trim()}\n\n---\n\n${rollup}`;

}



function childrenBlockingRollup(children: Goal[]): Goal[] {

  return children.filter((c) => !isChildGoalComplete(c));

}



export async function resolveParentRollupSummary(

  parent: Goal,

  children: Goal[],

): Promise<string> {

  const fallback = buildParentRollupSummary(parent, children);

  try {

    const settings = loadSettings();

    const { summary, llmError } = await synthesizeParentRollupSummary(

      {

        parentTitle: parent.title,

        parentAcceptance: parent.acceptance,

        children: children.map((child) => ({

          title: child.title,

          resultSummary: child.resultSummary ?? "",

        })),

      },

      settings,

      process.env,

      resolveMergedLlmContext({ goalId: parent.id }),

    );

    if (summary?.trim()) {

      appendLog(parent.id, "info", "已使用 Coach 智能汇总子任务结果");

      return summary.trim();

    }

    if (llmError) {

      appendLog(parent.id, "info", `智能汇总未启用，已使用默认拼接：${llmError}`);

    }

  } catch (err) {

    appendLog(

      parent.id,

      "warn",

      `智能汇总失败，已使用默认拼接：${err instanceof Error ? err.message : String(err)}`,

    );

  }

  return fallback;

}



async function applyParentRollup(

  parent: Goal,

  children: Goal[],

  rollupSummary: string,

): Promise<void> {

  if (parent.status === "running") {

    cancelRunning(parent.id);

  }



  if (parent.status === "awaiting_review") {

    parent.resultSummary = mergeRollupSummary(parent.resultSummary, rollupSummary);

    parent.updatedAt = new Date().toISOString();

    updateGoal(parent);

    broadcast({ type: "goal.updated", goal: parent });

    appendLog(

      parent.id,

      "info",

      `全部子任务已完成，已合并子任务结果到父目标验收摘要`,

    );

    if (parent.autoReview) {

      void import("./auto-review.js").then(({ maybeAutoReview }) =>

        maybeAutoReview(parent.id),

      );

    }

    return;

  }



  if (parent.status === "draft") {

    parent.status = "running";

    parent.progress = 0;

    parent.updatedAt = new Date().toISOString();

    updateGoal(parent);

    broadcast({ type: "goal.updated", goal: parent });

  }



  const latest = getGoalById(parent.id);

  if (!latest || latest.status !== "running") return;

  if (!canTransition("running", "awaiting_review")) return;



  const merged = mergeRollupSummary(latest.resultSummary, rollupSummary);

  const result = markGoalComplete(latest.id, merged);

  if (!result.ok) {

    appendLog(

      latest.id,

      "warn",

      `子任务已全部完成，但父目标无法进入验收：${result.error}`,

    );

    return;

  }

  appendLog(

    latest.id,

    "info",

    `全部 ${children.length} 个子任务已完成，父目标已进入验收`,

  );



  if (result.goal.autoReview) {

    void import("./auto-review.js").then(({ maybeAutoReview }) =>

      maybeAutoReview(latest.id),

    );

  }

}



async function rollUpParentGoalAsync(completedChildId: string): Promise<void> {

  const child = getGoalById(completedChildId);

  if (!child?.parentGoalId) return;



  const parent = getGoalById(child.parentGoalId);

  if (!parent) return;

  if (parent.status === "done" || parent.status === "cancelled") return;



  const children = listChildGoals(parent.id);

  if (children.length === 0) return;



  const blocking = childrenBlockingRollup(children);

  if (blocking.length > 0) {

    const failed = blocking.filter((c) => c.status === "failed");

    if (failed.length > 0) {

      appendLog(

        parent.id,

        "warn",

        `子任务失败（${failed.map((f) => f.title).join("、")}），父目标暂不自动验收`,

      );

      broadcast({ type: "goal.updated", goal: parent });

    }

    return;

  }



  const rollupSummary = await resolveParentRollupSummary(parent, children);

  await applyParentRollup(parent, children, rollupSummary);

}



/**

 * 当某个子目标被标记为 done 后，若同级子任务均已 done，则将父目标 rollup 到 awaiting_review。

 * 父目标若开启 autoReview，会继续走自动验收；通过后 approveGoal 会递归向上 rollup。

 */

export function maybeRollUpParentGoal(completedChildId: string): void {

  void rollUpParentGoalAsync(completedChildId);

}



/** @internal 供测试 await 异步 rollup */

export async function rollUpParentGoalForTest(completedChildId: string): Promise<void> {

  await rollUpParentGoalAsync(completedChildId);

}


