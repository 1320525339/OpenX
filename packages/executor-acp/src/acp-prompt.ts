import {
  buildExecutionPrompt,
  type ExecutorContext,
} from "@openx/executor-core";
import {
  CREW_FOREMAN_PROMPT_APPENDIX,
  prependResumeTranscript,
} from "@openx/shared";

/** 组装 ACP 首轮/续跑 prompt（含 OpenX transcript 补偿） */
export function buildAcpTurnPrompt(
  ctx: ExecutorContext,
  opts?: { resume?: boolean; steer?: boolean },
): string {
  const continuation = ctx.crewContinuationPrompt?.trim();
  const basePrompt = continuation
    ? continuation
    : [
        buildExecutionPrompt(ctx.goal, ctx.priorLogs ?? [], ctx.enabledSkills, {
          isRework: ctx.isRework,
          priorSummaries: ctx.priorSummaries,
          priorReviewRounds: ctx.priorReviewRounds,
          agentRole: ctx.agentRole,
          workspaceRoot: ctx.workspaceRoot,
          llmContext: ctx.llmContext,
          projectKnowledge: ctx.projectKnowledge,
        }),
        CREW_FOREMAN_PROMPT_APPENDIX,
      ].join("\n\n");
  if (opts?.resume || opts?.steer) {
    return prependResumeTranscript(basePrompt, ctx.resumeTranscript);
  }
  return basePrompt;
}
