import { useState } from "react";
import { useGoalReviewRounds } from "../lib/use-goal-review-rounds";

type Props = {
  goalId: string;
  compact?: boolean;
  showFeedback?: boolean;
  feedback?: string;
  onFeedbackChange?: (value: string) => void;
  onApprove?: () => void;
  onRework?: (reason: string) => void;
  onTriggerReview?: () => void;
};

export function ReviewTimelineCompact({
  goalId,
  compact = true,
  showFeedback = false,
  feedback = "",
  onFeedbackChange,
  onApprove,
  onRework,
  onTriggerReview,
}: Props) {
  const { rounds, loading, error, refresh } = useGoalReviewRounds(goalId);
  const [localFeedback, setLocalFeedback] = useState("");
  const feedbackValue = onFeedbackChange !== undefined ? feedback : localFeedback;
  const updateFeedback = (value: string) => {
    if (onFeedbackChange) onFeedbackChange(value);
    else setLocalFeedback(value);
  };

  const latest = rounds[rounds.length - 1];
  const recent = rounds.slice(-2);

  return (
    <div className={`review-timeline-compact${compact ? " is-compact" : ""}`}>
      <div className="review-timeline-compact-head">
        <strong>审查记录</strong>
        {onTriggerReview ? (
          <button type="button" className="btn-text" onClick={onTriggerReview}>
            触发审查
          </button>
        ) : null}
      </div>
      {loading ? (
        <p className="review-timeline-compact-hint">加载中…</p>
      ) : error ? (
        <p className="review-timeline-compact-hint form-error">
          {error}{" "}
          <button type="button" className="btn-text" onClick={() => void refresh(true)}>
            重试
          </button>
        </p>
      ) : recent.length === 0 ? (
        <p className="review-timeline-compact-hint">暂无审查记录</p>
      ) : (
        <ul className="review-timeline-compact-list">
          {recent.map((entry) => (
            <li key={`${entry.round}-${entry.timestamp}`} className={entry.verdict}>
              <span className="review-timeline-compact-round">{entry.roundLabel}</span>
              <span className={`review-timeline-compact-verdict ${entry.verdict}`}>
                {entry.verdict === "pass" ? "通过" : "未通过"}
              </span>
              <p className="review-timeline-compact-reason">{entry.reason}</p>
            </li>
          ))}
        </ul>
      )}
      {latest?.reworkInstruction ? (
        <pre className="review-timeline-compact-instruction">{latest.reworkInstruction}</pre>
      ) : null}
      {showFeedback ? (
        <textarea
          className="review-timeline-compact-feedback"
          rows={2}
          value={feedbackValue}
          placeholder="指出问题、补充验收要求或修改文案…"
          onChange={(e) => updateFeedback(e.target.value)}
        />
      ) : null}
      {(onApprove || onRework) && (
        <div className="review-timeline-compact-actions">
          {onApprove ? (
            <button type="button" className="btn compact primary" onClick={onApprove}>
              确认完成
            </button>
          ) : null}
          {onRework ? (
            <button
              type="button"
              className="btn compact warn"
              onClick={() => onRework(feedbackValue.trim())}
            >
              提交返工
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
