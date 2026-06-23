import { useState } from "react";
import type { Goal, GoalRunState } from "@openx/shared";
import { createEmptyRunState } from "@openx/shared";
import { truncate } from "../lib/goal-detail";
import { GoalTaskExpandBody, goalResultTeaser } from "./GoalTaskExpandBody";
import {
  GoalTaskActions,
  goalHasTaskActions,
  type GoalTaskActionHandlers,
} from "./GoalTaskActions";
import { CrewDialogueSummary } from "./CrewDialogueSummary";
import { RunConsole } from "./RunConsole";
import {
  ChatTaskOrderDispatch,
  ChatTaskOrderFooter,
  ChatTaskOrderHeader,
} from "./ChatTaskOrderSections";
import { executorAgentShortName } from "../lib/chat-task-order";

type Props = {
  goal?: Goal;
  run?: GoalRunState;
  fallbackTitle: string;
  onLocate?: () => void;
  onOpenDetail?: () => void;
  handlers?: GoalTaskActionHandlers;
};

/** 对话流内任务单：工头派单 + 实时活动流 + 托管状态底栏 */
export function ChatTaskChip({
  goal,
  run,
  fallbackTitle,
  onOpenDetail,
  handlers,
}: Props) {
  const [expanded, setExpanded] = useState(() => goal?.status === "running");

  const status = goal?.status ?? "draft";
  const title = goal?.title ?? fallbackTitle;
  const teaser = goal ? goalResultTeaser(goal) : null;
  const goalRun = goal && (run ?? createEmptyRunState(goal.id));
  const showRunConsole =
    goal &&
    goalRun &&
    (goal.status === "running" ||
      goalRun.active ||
      goalRun.events.length > 0 ||
      Boolean(goalRun.liveText) ||
      Boolean(goalRun.thinkingText));
  const actionHandlers: GoalTaskActionHandlers | undefined = goal
    ? {
        ...handlers,
        onOpenDetail: onOpenDetail ?? handlers?.onOpenDetail,
      }
    : undefined;
  const showCollapsedActions =
    goal && !expanded && goalHasTaskActions(goal, actionHandlers);
  const agentShort = goal ? executorAgentShortName(goal.executorId) : "Agent";

  return (
    <div className="chat-turn chat-turn-taskchip">
      <article
        className={`chat-task-card chat-task-order status-${status}${expanded ? " expanded" : ""}`}
      >
        <ChatTaskOrderHeader
          goal={goal}
          title={title}
          expanded={expanded}
          onToggle={() => setExpanded((v) => !v)}
          run={goalRun}
          showLiveMeta={Boolean(showRunConsole)}
        />

        {goal ? <ChatTaskOrderDispatch goal={goal} /> : null}

        {goal ? (
          <div className="chat-task-order-feed">
            <div className="chat-task-crew-wrap" onClick={(e) => e.stopPropagation()}>
              <CrewDialogueSummary
                goalId={goal.id}
                crewStatus={goal.crewStatus}
                embedded
              />
            </div>

            {showRunConsole && goalRun ? (
              <div className="chat-task-run-wrap" onClick={(e) => e.stopPropagation()}>
                <RunConsole run={goalRun} compact taskOrder agentShortName={agentShort} />
              </div>
            ) : null}

            {!showRunConsole && !expanded && teaser ? (
              <p className="chat-task-card-teaser">{truncate(teaser, 120)}</p>
            ) : null}
          </div>
        ) : null}

        {goal ? <ChatTaskOrderFooter goal={goal} run={goalRun} /> : null}

        {showCollapsedActions && (
          <div
            className="goal-task-actions-slot"
            onClick={(e) => e.stopPropagation()}
          >
            <GoalTaskActions goal={goal} handlers={actionHandlers} compact />
          </div>
        )}

        {expanded && goal && (
          <div className="chat-task-card-body">
            <GoalTaskExpandBody goal={goal} handlers={actionHandlers} />
          </div>
        )}
      </article>
    </div>
  );
}
