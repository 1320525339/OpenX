import { mergeLlmContextSettings, type LlmContextSettings } from "@openx/shared";
import { getConversationById, getGoalById, getProjectById } from "./db.js";
import { loadSettings } from "./settings-store.js";

export function resolveMergedLlmContext(opts?: {
  conversationId?: string;
  goalId?: string;
}): LlmContextSettings {
  const settings = loadSettings();
  let projectLlmContext: LlmContextSettings | undefined;

  if (opts?.conversationId) {
    const conv = getConversationById(opts.conversationId);
    const project = conv ? getProjectById(conv.projectId) : undefined;
    projectLlmContext = project?.llmContext;
  } else if (opts?.goalId) {
    const goal = getGoalById(opts.goalId);
    if (goal?.conversationId) {
      const conv = getConversationById(goal.conversationId);
      const project = conv ? getProjectById(conv.projectId) : undefined;
      projectLlmContext = project?.llmContext;
    }
  }

  return mergeLlmContextSettings(settings.llmContext, projectLlmContext);
}
