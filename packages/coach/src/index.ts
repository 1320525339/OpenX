/** @openx/coach — OpenX 工头 Coach（规则引擎 + Vercel AI SDK LLM，参考 OpenCode） */

export { refineGoalRules, coachChatReplyRules } from "./rules.js";
export {
  refineGoalLlm,
  coachAgentReplyLlm,
  coachChatReplyLlm,
  resolveLlmCredentials,
  testLlmConnection,
  type LlmEnv,
} from "./llm.js";
export {
  refineGoal,
  coachChatReply,
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
  formatCoachLlmError,
  classifyCoachLlmError,
  isCoachQuotaError,
  type CoachLlmErrorKind,
} from "./llm-errors.js";

/** @deprecated 使用 refineGoal */
export { refineGoalRules as refineGoalLegacy } from "./rules.js";
/** @deprecated 使用 coachChatReply */
export { coachChatReplyRules as coachChatReplyLegacy } from "./rules.js";
