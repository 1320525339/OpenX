import type { Goal } from "@openx/shared";
import {
  goalDisplayHint,
  goalDisplayLabel,
  goalDisplayOutcome,
  CONNECT_ANY_EXECUTOR_ID,
  EXECUTOR_AUTO,
} from "@openx/shared";
import { connectClaimStatus, executorDisplayLabel } from "../lib/executors";
import { buildGoalContext, formatDispatchSummary, truncate } from "../lib/goal-detail";
import { GoalTaskExpandBody, goalResultTeaser } from "./GoalTaskExpandBody";
import { GoalTaskActions, goalHasTaskActions, type GoalTaskActionHandlers } from "./GoalTaskActions";
import { WorkOrderIdBadge } from "./WorkOrderIdBadge";

type Props = {
  goal: Goal;
  depth: number;
  allGoals: Goal[];
  selected: boolean;
  expanded: boolean;
  editMode: boolean;
  editable: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  handlers: GoalTaskActionHandlers;
  onCardClick: () => void;
  showConnectClaimStatus?: boolean;
  conversationTitles?: Record<string, string>;
  projectTitles?: Record<string, string>;
  conversationProjectIds?: Record<string, string>;
  pinVariant?: boolean;
  latestLogMessage?: string;
};

function executorLabel(executorId: Goal["executorId"]): string {
  if (executorId === EXECUTOR_AUTO) return "自动";
  return executorDisplayLabel(executorId);
}

export function GoalTaskCard({
  goal: g,
  depth,
  allGoals,
  selected,
  expanded,
  editMode,
  editable,
  selectedIds,
  onToggleSelect,
  handlers,
  onCardClick,
  showConnectClaimStatus = false,
  conversationTitles,
  projectTitles,
  conversationProjectIds,
  pinVariant = false,
  latestLogMessage,
}: Props) {
  const { parent, dependencies } = buildGoalContext(allGoals, g);
  const resultTeaser = goalResultTeaser(g);
  const showCollapsedActions =
    !editMode && !expanded && goalHasTaskActions(g, handlers) && !pinVariant;
  const hint = goalDisplayHint(g);

  if (pinVariant && !editMode) {
    return (
      <div
        data-goal-id={g.id}
        role="button"
        tabIndex={0}
        className={`goal-card goal-card-pin${selected ? " selected" : ""}${g.status === "awaiting_review" ? " awaiting_review" : ""}${g.status === "failed" || g.status === "cancelled" ? " failed" : ""}${depth > 0 ? " goal-card-child" : ""}`}
        style={depth > 0 ? { marginLeft: `${depth * 0.65}rem` } : undefined}
        onClick={onCardClick}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          onCardClick();
        }}
      >
        <div className="goal-card-pin-head">
          <div className="goal-card-pin-main">
            {g.orderNo > 0 ? <WorkOrderIdBadge orderNo={g.orderNo} /> : null}
            <strong className="goal-card-title">{g.title}</strong>
          </div>
          <div className="goal-card-pin-side">
            <span className="executor-tag">{executorLabel(g.executorId)}</span>
            <span
              className={`status-pill outcome-${goalDisplayOutcome(g)}${g.status === "awaiting_review" ? " awaiting_review" : ""}`}
            >
              {hint ?? goalDisplayLabel(g)}
            </span>
          </div>
        </div>

        <div className="goal-card-pin-progress">
          <div className="progress-bar">
            <span style={{ width: `${g.progress}%` }} />
          </div>
          <span className="goal-card-pin-progress-label">{g.progress}%</span>
        </div>

        {g.acceptance?.trim() ? (
          <p className="goal-card-pin-acceptance">{truncate(g.acceptance.trim(), 96)}</p>
        ) : null}

        {latestLogMessage ? (
          <p className="goal-card-pin-log">{truncate(latestLogMessage, 120)}</p>
        ) : resultTeaser && !selected ? (
          <p className="goal-card-pin-log">{truncate(resultTeaser, 120)}</p>
        ) : null}

        {selected && goalHasTaskActions(g, handlers) ? (
          <div className="goal-card-pin-actions" onClick={(e) => e.stopPropagation()}>
            <GoalTaskActions goal={g} handlers={handlers} compact />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      data-goal-id={g.id}
      role="button"
      tabIndex={0}
      className={`goal-card${selected ? " selected" : ""}${expanded ? " expanded" : ""}${g.status === "awaiting_review" ? " awaiting_review" : ""}${editMode ? " edit-mode" : ""}${depth > 0 ? " goal-card-child" : ""}${!editable ? " goal-card-readonly" : ""}`}
      style={depth > 0 ? { marginLeft: `${depth * 0.75}rem` } : undefined}
      onClick={onCardClick}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        onCardClick();
      }}
    >
      {g.orderNo > 0 ? (
        <div className="goal-card-order-banner">
          <WorkOrderIdBadge orderNo={g.orderNo} />
        </div>
      ) : null}
      <div className="goal-card-head">
        {editMode ? (
          <label className="goal-card-check" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              disabled={!editable}
              checked={selectedIds.has(g.id)}
              onChange={() => onToggleSelect(g.id)}
            />
          </label>
        ) : (
          <div
            className="progress-ring"
            style={{ ["--goal-progress" as string]: `${g.progress}%` }}
          >
            {g.progress}%
          </div>
        )}
        <div className="goal-card-body">
          <div className="goal-card-title-row">
            <strong className="goal-card-title">{g.title}</strong>
            {conversationTitles?.[g.conversationId] ? (
              <span className="goal-card-conv" title="所属对话">
                {conversationTitles[g.conversationId]}
              </span>
            ) : null}
            {conversationProjectIds &&
            projectTitles?.[conversationProjectIds[g.conversationId]] ? (
              <span className="goal-card-project" title="所属项目">
                {projectTitles[conversationProjectIds[g.conversationId]]}
              </span>
            ) : null}
            {!editable ? <span className="goal-card-readonly-tag">只读</span> : null}
            <span
              className={`status-pill outcome-${goalDisplayOutcome(g)}${g.status === "awaiting_review" ? " awaiting_review" : ""}`}
            >
              {goalDisplayLabel(g)}
            </span>
            {goalDisplayHint(g) ? (
              <span className="status-hint">{goalDisplayHint(g)}</span>
            ) : null}
            <span className="executor-tag">{executorLabel(g.executorId)}</span>
            {!editMode ? (
              <span className={`goal-card-chevron${expanded ? " open" : ""}`} aria-hidden />
            ) : null}
            {showConnectClaimStatus ? (
              (() => {
                const claim = connectClaimStatus(g);
                return claim ? (
                  <span
                    className={`status-pill ${g.executorId === CONNECT_ANY_EXECUTOR_ID ? "draft" : "running"}`}
                  >
                    {claim}
                  </span>
                ) : null;
              })()
            ) : null}
          </div>
          {!editMode && !expanded && g.status === "running" ? (
            <div className="progress-bar">
              <span style={{ width: `${g.progress}%` }} />
            </div>
          ) : null}
          {!editMode && !expanded && resultTeaser ? (
            <p className="goal-card-result-teaser">{truncate(resultTeaser, 140)}</p>
          ) : null}
          {editMode ? (
            <p className="goal-card-meta">
              进度 {g.progress}%
              {g.parentGoalId ? " · 子目标" : ""}
            </p>
          ) : null}
          {!expanded && formatDispatchSummary(g) ? (
            <p className="goal-card-dispatch">{formatDispatchSummary(g)}</p>
          ) : null}
          {(parent || dependencies.length > 0) && !editMode && !expanded ? (
            <p className="goal-card-meta">
              {parent ? `子任务 · ${parent.title}` : "子任务"}
              {dependencies.length > 0
                ? ` · 等待 ${dependencies.map((d) => d.title).join("、")}`
                : ""}
            </p>
          ) : null}
          {showCollapsedActions ? (
            <div className="goal-task-actions-slot" onClick={(e) => e.stopPropagation()}>
              <GoalTaskActions goal={g} handlers={handlers} compact />
            </div>
          ) : null}
          {!editMode && expanded ? (
            <div className="goal-card-expand-wrap" onClick={(e) => e.stopPropagation()}>
              <GoalTaskExpandBody goal={g} handlers={handlers} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
