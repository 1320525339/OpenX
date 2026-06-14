import type { ReviewVerdict } from "@openx/coach";
import { persistForemanReview } from "./crew-persist.js";

/** 工头验收：记录审查结论到工头↔施工队线程（合并原 auto-review 叙事） */
export function recordForemanReviewVerdict(
  goalId: string,
  verdict: ReviewVerdict,
  opts?: { iteration?: number; verifySummary?: string },
): void {
  const iteration = opts?.iteration ?? 1;
  const passed = verdict.verdict === "pass";
  const summary = passed
    ? `工头验收通过（第 ${iteration} 轮）：${verdict.reason}`
    : `工头验收未通过（第 ${iteration} 轮）：${verdict.reason}`;
  persistForemanReview(goalId, summary, {
    verdict,
    iteration,
    verifySummary: opts?.verifySummary,
  });
}
