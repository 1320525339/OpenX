import { useCallback, useEffect, useState } from "react";
import { api, type ReviewRoundEntry } from "../api";

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
  const [rounds, setRounds] = useState<ReviewRoundEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [localFeedback, setLocalFeedback] = useState("");
  const feedbackValue = onFeedbackChange !== undefined ? feedback : localFeedback;
  const updateFeedback = (value: string) => {
    if (onFeedbackChange) onFeedbackChange(value);
    else setLocalFeedback(value);
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { rounds: data } = await api.getGoalReviewRounds(goalId);
      setRounds(data);
    } catch {
      setRounds([]);
    } finally {
      setLoading(false);
    }
  }, [goalId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
      ) : recent.length === 0 ? (
        <p className="review-timeline-compact-hint">尚无审查记录</p>
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
