import { useState } from "react";
import type { Goal } from "@openx/shared";
import { goalStatusText, truncate } from "../lib/goal-detail";
import { executorDisplayLabel } from "../lib/executors";
import { GoalTaskExpandBody, goalResultTeaser } from "./GoalTaskExpandBody";
import {
  GoalTaskActions,
  goalHasTaskActions,
  type GoalTaskActionHandlers,
} from "./GoalTaskActions";

type Props = {
  goal?: Goal;
  fallbackTitle: string;
  onLocate?: () => void;
  onOpenDetail?: () => void;
  handlers?: GoalTaskActionHandlers;
};

function displayProgress(goal: Goal | undefined): number {
  if (!goal) return 0;
  if (goal.status === "awaiting_review" || goal.status === "done") return 100;
  if (goal.status === "running") return goal.progress;
  return 0;
}

/** 对话流内任务芯片：点击展开/收起 */
export function ChatTaskChip({
  goal,
  fallbackTitle,
  onOpenDetail,
  handlers,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const status = goal?.status ?? "draft";
  const title = goal?.title ?? fallbackTitle;
  const progress = displayProgress(goal);
  const teaser = goal ? goalResultTeaser(goal) : null;
  const actionHandlers: GoalTaskActionHandlers | undefined = goal
    ? {
        ...handlers,
        onOpenDetail: onOpenDetail ?? handlers?.onOpenDetail,
      }
    : undefined;
  const showCollapsedActions =
    goal && !expanded && goalHasTaskActions(goal, actionHandlers);

  return (
    <div className="chat-turn chat-turn-taskchip">
      <article
        className={`chat-task-card status-${status}${expanded ? " expanded" : ""}`}
      >
        <button
          type="button"
          className="chat-task-card-head"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <div
            className="progress-ring chat-task-progress"
            style={{ ["--goal-progress" as string]: `${progress}%` }}
            aria-hidden
          >
            {progress}%
          </div>
          <div className="chat-task-card-head-main">
            <div className="chat-task-card-title-row">
              <strong className="chat-task-card-title">{title}</strong>
              <span className={`status-pill compact ${status}`}>
                {goal ? goalStatusText(goal) : "已创建"}
              </span>
              {goal && (
                <span className="executor-tag">{executorDisplayLabel(goal.executorId)}</span>
              )}
              <span className={`goal-card-chevron${expanded ? " open" : ""}`} aria-hidden />
            </div>
            {!expanded && teaser && (
              <p className="chat-task-card-teaser">{truncate(teaser, 100)}</p>
            )}
            {goal?.status === "running" && !expanded && (
              <div className="progress-bar chat-task-card-progress thin">
                <span style={{ width: `${goal.progress}%` }} />
              </div>
            )}
          </div>
        </button>

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
