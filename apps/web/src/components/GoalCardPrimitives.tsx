import type { Goal } from "@openx/shared";
import { goalDisplayHint, goalDisplayLabel, goalDisplayOutcome } from "@openx/shared";
import { goalStatusText } from "../lib/goal-detail";

type StatusPillProps = {
  goal: Goal;
  /** outcome-* 语义（任务台）或 status 类名（执行芯片） */
  variant?: "outcome" | "status";
  compact?: boolean;
  /** 优先显示 hint（如 pin 卡侧栏） */
  preferHint?: boolean;
  className?: string;
};

/** 任务卡共用状态 pill，统一 outcome / status 两种语义 */
export function GoalStatusPill({
  goal,
  variant = "outcome",
  compact = false,
  preferHint = false,
  className = "",
}: StatusPillProps) {
  const hint = goalDisplayHint(goal);
  const label =
    preferHint && hint
      ? hint
      : variant === "status"
        ? goalStatusText(goal)
        : goalDisplayLabel(goal);

  const classes = [
    "status-pill",
    "goal-status-pill",
    compact ? "compact" : "",
    variant === "outcome"
      ? `outcome-${goalDisplayOutcome(goal)}`
      : goal.status,
    goal.status === "awaiting_review" ? "awaiting_review" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return <span className={classes}>{label}</span>;
}

type ProgressBarProps = {
  progress: number;
  className?: string;
  showLabel?: boolean;
  labelClassName?: string;
};

/** 任务卡共用进度条 */
export function GoalProgressBar({
  progress,
  className = "",
  showLabel = false,
  labelClassName = "",
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, progress));
  return (
    <div className={`goal-progress-row${className ? ` ${className}` : ""}`}>
      <div className="progress-bar">
        <span style={{ width: `${clamped}%` }} />
      </div>
      {showLabel ? (
        <span className={labelClassName || "goal-progress-label"}>{clamped}%</span>
      ) : null}
    </div>
  );
}
