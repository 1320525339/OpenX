import {
  formatCrewExchangeCoachLine,
  type CrewDirective,
  type CrewEscalation,
  type CrewQuestion,
} from "@openx/shared";
import { appendCrewExchange, getGoalById, saveCoachMessage } from "./db.js";

export function persistCrewQuestion(goalId: string, question: CrewQuestion) {
  const goal = getGoalById(goalId);
  if (!goal) return;
  const summary = question.prompt.slice(0, 500);
  appendCrewExchange({
    goalId,
    conversationId: goal.conversationId,
    direction: "crew_to_foreman",
    summary,
    payload: question,
  });
  saveCoachMessage(
    goal.conversationId,
    "coach",
    formatCrewExchangeCoachLine("crew_to_foreman", summary),
    goalId,
  );
}

export function persistForemanDirective(goalId: string, directive: CrewDirective) {
  const goal = getGoalById(goalId);
  if (!goal) return;
  appendCrewExchange({
    goalId,
    conversationId: goal.conversationId,
    direction: "foreman_to_crew",
    summary: directive.message.slice(0, 500),
    payload: directive,
  });
  saveCoachMessage(
    goal.conversationId,
    "coach",
    formatCrewExchangeCoachLine("foreman_to_crew", directive.message.slice(0, 500)),
    goalId,
  );
}

export function persistForemanEscalation(goalId: string, escalation: CrewEscalation) {
  const goal = getGoalById(goalId);
  if (!goal) return;
  appendCrewExchange({
    goalId,
    conversationId: goal.conversationId,
    direction: "foreman_escalation",
    summary: escalation.prompt.slice(0, 500),
    payload: escalation,
  });
  saveCoachMessage(
    goal.conversationId,
    "coach",
    formatCrewExchangeCoachLine("foreman_escalation", escalation.prompt.slice(0, 500)),
    goalId,
  );
}

/** 开发商在对话中确认后，转告施工队 */
export function persistUserCrewDirective(goalId: string, directive: CrewDirective) {
  const goal = getGoalById(goalId);
  if (!goal) return;
  const summary = `开发商 › ${directive.message.slice(0, 480)}`;
  appendCrewExchange({
    goalId,
    conversationId: goal.conversationId,
    direction: "foreman_to_crew",
    summary,
    payload: directive,
  });
  saveCoachMessage(
    goal.conversationId,
    "coach",
    formatCrewExchangeCoachLine("foreman_to_crew", summary),
    goalId,
  );
}

export function persistForemanReview(
  goalId: string,
  summary: string,
  payload?: unknown,
) {
  const goal = getGoalById(goalId);
  if (!goal) return;
  appendCrewExchange({
    goalId,
    conversationId: goal.conversationId,
    direction: "foreman_review",
    summary: summary.slice(0, 500),
    payload,
  });
  saveCoachMessage(
    goal.conversationId,
    "coach",
    formatCrewExchangeCoachLine("foreman_review", summary.slice(0, 500)),
    goalId,
  );
}
