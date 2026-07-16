import type { Goal, GoalRunState } from "@openx/shared";
import { goalDisplayHint, goalDisplayLabel, goalDisplayOutcome, isPausedGoal, isRunPausedAwaitingUser } from "@openx/shared";
import { goalStatusText } from "../lib/goal-detail";
import { executorDisplayLabel } from "../lib/executors";
import {
  executorAgentShortName,
  formatGoalRecentTime,
  goalHasDispatchBrief,
} from "../lib/chat-task-order";
import { describeForemanManagedStatus } from "../lib/foreman-crew-status";
import { WorkOrderIdBadge } from "./WorkOrderIdBadge";

type HeaderProps = {
  goal?: Goal;
  title: string;
  expanded: boolean;
  onToggle?: () => void;
  run?: GoalRunState;
  showLiveMeta?: boolean;
};

export function ChatTaskOrderHeader({
  goal,
  title,
  expanded,
  onToggle,
  run,
  showLiveMeta,
}: HeaderProps) {
  const status = goal?.status ?? "draft";
  const hint = goal ? goalDisplayHint(goal) : null;
  const outcomeLabel = goal ? goalDisplayLabel(goal) : "已创建";
  const outcome = goal ? goalDisplayOutcome(goal) : "incomplete";
  const paused =
    (goal ? isPausedGoal(goal) : false) || (run ? isRunPausedAwaitingUser(run) : false);
  const live =
    showLiveMeta &&
    run &&
    !paused &&
    (run.active || Boolean(run.liveText) || Boolean(run.thinkingText) || run.events.length > 0);

  const inner = (
    <>
      <div className="chat-task-order-titleline">
        {goal?.orderNo && goal.orderNo > 0 ? (
          <WorkOrderIdBadge orderNo={goal.orderNo} className="chat-task-order-id" />
        ) : null}
        <span className="chat-task-order-title">{title}</span>
        {onToggle ? (
          <span className={`goal-card-chevron chat-task-order-chevron${expanded ? " open" : ""}`} aria-hidden />
        ) : null}
      </div>
      <div className="chat-task-order-meta">
        {goal ? (
          <span className="chat-task-meta-item">
            <span className="chat-task-meta-dot" aria-hidden />
            施工队 {executorAgentShortName(goal.executorId)}
          </span>
        ) : null}
        {paused ? (
          <span className="chat-task-meta-item chat-task-meta-paused">
            <span className="chat-task-meta-dot paused" aria-hidden />
            {goal?.crewStatus === "awaiting_user" ? "等待决策" : "已暂停"}
          </span>
        ) : live ? (
          <span className="chat-task-meta-item chat-task-meta-live">
            <span className="chat-task-meta-dot live" aria-hidden />
            实时输出
          </span>
        ) : null}
        <span className={`chat-task-meta-status outcome-${outcome}`}>
          {outcomeLabel}
          {hint ? ` · ${hint}` : ""}
        </span>
        {goal?.updatedAt ? (
          <time className="chat-task-meta-time" dateTime={goal.updatedAt}>
            最近 {formatGoalRecentTime(goal.updatedAt)}
          </time>
        ) : null}
        {goal && !onToggle ? (
          <span className={`status-pill compact ${status} chat-task-meta-pill`}>
            {goalStatusText(goal)}
          </span>
        ) : null}
      </div>
    </>
  );

  if (onToggle) {
    return (
      <button
        type="button"
        className="chat-task-order-head"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        {inner}
      </button>
    );
  }

  return <header className="chat-task-order-head static">{inner}</header>;
}

export function ChatTaskOrderDispatch({ goal }: { goal: Goal }) {
  if (!goalHasDispatchBrief(goal)) return null;
  return (
    <section className="chat-task-dispatch" aria-label="工头派单">
      <div className="chat-task-dispatch-label">工头派单</div>
      {goal.executionPrompt?.trim() ? (
        <div className="chat-task-dispatch-row">
          <span className="chat-task-dispatch-key">目标</span>
          <p className="chat-task-dispatch-value">{goal.executionPrompt.trim()}</p>
        </div>
      ) : null}
      {goal.constraints?.length ? (
        <div className="chat-task-dispatch-row">
          <span className="chat-task-dispatch-key">约束</span>
          <p className="chat-task-dispatch-value">{goal.constraints.join("；")}</p>
        </div>
      ) : null}
      {goal.executorId ? (
        <div className="chat-task-dispatch-row dim">
          <span className="chat-task-dispatch-key">施工队</span>
          <p className="chat-task-dispatch-value">{executorDisplayLabel(goal.executorId)}</p>
        </div>
      ) : null}
    </section>
  );
}

export function ChatTaskOrderFooter({ goal, run }: { goal: Goal; run?: GoalRunState }) {
  const foreman = describeForemanManagedStatus(goal, run);
  if (!foreman) return null;
  const tone =
    isPausedGoal(goal) || goal.crewStatus === "awaiting_user"
      ? "awaiting-user"
      : goal.crewStatus === "awaiting_foreman"
        ? "awaiting-foreman"
        : "active";
  return (
    <footer className={`chat-task-foreman-footer tone-${tone}`}>
      <span className="chat-task-foreman-primary">{foreman.primary}</span>
      <span className="chat-task-foreman-sep" aria-hidden>
        ·
      </span>
      <span className="chat-task-foreman-secondary">{foreman.secondary}</span>
    </footer>
  );
}
