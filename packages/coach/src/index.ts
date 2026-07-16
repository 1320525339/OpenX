/** @openx/coach — OpenX 工头 Coach（规则引擎 + Vercel AI SDK LLM，参考 OpenCode） */

export { refineGoalRules, coachChatReplyRules } from "./rules.js";
export {
  refineGoalLlm,
  coachAgentReplyLlm,
  coachChatReplyLlm,
  createModel,
  generateStructuredObject,
  generateCoachText,
  resolveLlmCredentials,
  testLlmConnection,
  type LlmEnv,
} from "./llm.js";
export {
  refineGoal,
  coachChatReply,
  coachContinueAfterWorkOrderTool,
  coachContinueAfterClarifyTool,
  coachContinueAfterOperatorTool,
  coachContinueAfterDispatchPermissionTool,
  getCoachRuntime,
  getPiRuntime,
  testCoachConnection,
  testPiConnection,
  type CoachRuntime,
  type LlmRole,
} from "./service.js";
export { buildNextStepsUserMessage, type NextStepsTrigger } from "./next-steps.js";
export { formatFeedbackNotes } from "./prompts.js";
export {
  buildCoachThreadBlock,
  buildCoachThreadPrefixFromRecords,
  COACH_THREAD_HISTORY_HEADING,
  DEFAULT_COACH_THREAD_CHAR_BUDGET,
  type BuildCoachThreadPrefixOptions,
} from "./coach-thread-prompt.js";
export {
  compactCoachThreadTurns,
  detectCoachThreadPressure,
  buildDeterministicCoachCheckpoint,
  type CoachThreadPressure,
} from "./coach-thread-compaction.js";
export {
  reviewGoalCompletion,
  reviewParentGoalCompletion,
  ReviewVerdictSchema,
  ReviewReworkTargetSchema,
  type ReviewVerdict,
  type ReviewReworkTarget,
  type ReviewGoalInput,
  type ReviewGoalOptions,
  type ParentReviewInput,
  type ParentReviewChild,
} from "./review.js";
export {
  synthesizeParentRollupSummary,
  type ParentRollupInput,
  type ParentRollupChild,
} from "./rollup.js";
export { coachOperatorChatReply, extractDispatchPermissionProposal } from "./operator-chat.js";
export { coachKnowledgeChatReply } from "./knowledge-chat.js";
export {
  KNOWLEDGE_SAVE_TOOL_NAME,
  type KnowledgeToolGateway,
  type KnowledgeToolCallResult,
  type KnowledgeSaveToolInput,
  type KnowledgeSaveToolResult,
} from "./knowledge-tools.js";
export {
  resolveForemanDirectiveViaCoach,
  buildForemanCrewUserPrompt,
  type ForemanCrewInput,
  type ForemanCrewGoalContext,
  type ForemanCrewOptions,
} from "./foreman-crew.js";
export {
  resolveForemanTurnReviewViaCoach,
  buildForemanTurnReviewUserPrompt,
  type ForemanTurnReviewInputBundle,
} from "./foreman-turn-review.js";
export {
  buildConfiguredSystemPrompt,
  buildRefineSystemPrompt,
  renderCoachDynamicContext,
} from "./render-llm-prompt.js";
export type {
  OperatorToolGateway,
  OperatorToolCallResult,
  OperatorActionProposal,
} from "./operator-tools.js";
export {
  formatCoachLlmError,
  classifyCoachLlmError,
  isCoachQuotaError,
  type CoachLlmErrorKind,
} from "./llm-errors.js";
export {
  resolveRoundParticipants,
  generateParticipantReply,
  synthesizeRoundtable,
  LIST_ATTENDEES_TOOL,
  GET_PEER_REPLIES_TOOL,
  REQUEST_PEER_REPLY_TOOL,
  type MentionRouteResult,
  type ParticipantReplyInput,
  type ParticipantToolHandlers,
  type RoundtableAttendee,
  type PeerReplySnippet,
} from "./roundtable/index.js";

/** @deprecated 使用 refineGoal */
export { refineGoalRules as refineGoalLegacy } from "./rules.js";
/** @deprecated 使用 coachChatReply */
export { coachChatReplyRules as coachChatReplyLegacy } from "./rules.js";
