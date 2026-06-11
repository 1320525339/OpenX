import type { RefinedGoal, Settings } from "@openx/shared";
import { detectExecutors } from "./orchestrator.js";
import { recommendExecutorForGoal } from "./executor-recommend-service.js";
import {
  enrichRefinedWithChatDispatch,
  type DispatchInput,
} from "./goal-dispatch.js";

/** 为 refined 回填推荐执行器，并合并对话派单上下文 */
export async function backfillRefinedGoal(
  refined: RefinedGoal,
  opts: {
    settings: Settings;
    userDraft?: string;
    dispatch?: Pick<DispatchInput, "agentId" | "mcpIds" | "skillIds">;
  },
): Promise<RefinedGoal> {
  let out = refined;

  if (!out.executorId) {
    const executors = await detectExecutors();
    const rec = await recommendExecutorForGoal(
      {
        title: out.title,
        acceptance: out.acceptance,
        executionPrompt: out.executionPrompt,
        userDraft: opts.userDraft ?? out.title,
      },
      executors,
      opts.settings,
    );
    if (rec) {
      out = { ...out, executorId: rec.executorId };
    }
  }

  if (opts.dispatch) {
    out = enrichRefinedWithChatDispatch(out, opts.dispatch);
  }

  return out;
}
