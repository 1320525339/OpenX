import { useCallback, useEffect, useState } from "react";
import type { Goal } from "@openx/shared";
import { api, type ReviewRoundEntry } from "../api";

type Props = {
  goal: Goal;
  onReviewTriggered?: () => void;
};

function verdictLabel(verdict: ReviewRoundEntry["verdict"]): string {
  return verdict === "pass" ? "通过" : "未通过";
}

export function ReviewTimeline({ goal, onReviewTriggered }: Props) {
  const [rounds, setRounds] = useState<ReviewRoundEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const { rounds: data } = await api.getGoalReviewRounds(goal.id);
      setRounds(data);
      if (data.length > 0) {
        const latest = data[data.length - 1]!;
        setExpanded((prev) => ({ ...prev, [latest.round]: true }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [goal.id]);

  useEffect(() => {
    void refresh();
  }, [refresh, goal.updatedAt, goal.status, goal.iterationCount]);

  const handleTrigger = async () => {
    setTriggering(true);
    setError(undefined);
    try {
      const res = await api.triggerGoalReview(goal.id, { force: true });
      setRounds(res.rounds);
      onReviewTriggered?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTriggering(false);
    }
  };

  const showPanel =
    goal.autoReview ||
    goal.status === "awaiting_review" ||
    rounds.length > 0 ||
    (goal.iterationCount ?? 0) > 0;

  if (!showPanel) return null;

  const latestFail = [...rounds].reverse().find((r) => r.verdict === "fail");

  return (
    <div className="detail-block review-timeline-block">
      <div className="review-timeline-head">
        <h4>审查轮次时间线</h4>
        {goal.status === "awaiting_review" && (
          <button
            type="button"
            className="btn compact"
            disabled={triggering}
            onClick={() => void handleTrigger()}
          >
            {triggering ? "审查中…" : "触发审查员复核"}
          </button>
        )}
      </div>

      {goal.autoReview ? (
        <p className="review-timeline-hint">
          自动审查已开启 · 第 {(goal.iterationCount ?? 0) + 1}/
          {goal.maxIterations ?? 20} 轮
          {latestFail ? " · 最近一轮未通过，可人工确认或触发复核" : ""}
        </p>
      ) : (
        <p className="review-timeline-hint">未开自动审查时可手动触发审查员复核</p>
      )}

      {error ? <p className="review-timeline-error">{error}</p> : null}

      {loading && rounds.length === 0 ? (
        <p className="settings-hint">加载审查记录…</p>
      ) : rounds.length === 0 ? (
        <p className="settings-hint">尚无审查记录（交工后将自动进入审查）</p>
      ) : (
        <ol className="review-timeline">
          {rounds.map((entry) => {
            const isOpen = expanded[entry.round] ?? false;
            const isLatest = entry === rounds[rounds.length - 1];
            return (
              <li
                key={`${entry.round}-${entry.timestamp}`}
                className={`review-timeline-item ${entry.verdict}${isLatest ? " latest" : ""}`}
              >
                <button
                  type="button"
                  className="review-timeline-item-head"
                  onClick={() =>
                    setExpanded((prev) => ({
                      ...prev,
                      [entry.round]: !isOpen,
                    }))
                  }
                >
                  <span className="review-timeline-round">{entry.roundLabel}</span>
                  <span className={`review-timeline-verdict ${entry.verdict}`}>
                    {verdictLabel(entry.verdict)}
                  </span>
                  <time className="review-timeline-time">
                    {new Date(entry.timestamp).toLocaleString("zh-CN")}
                  </time>
                </button>
                <p className="review-timeline-reason">{entry.reason}</p>
                {isOpen && (
                  <div className="review-timeline-body">
                    {entry.reworkInstruction ? (
                      <div className="review-timeline-section">
                        <strong>修改清单</strong>
                        <pre className="detail-pre">{entry.reworkInstruction}</pre>
                      </div>
                    ) : null}
                    {entry.reworkTargets?.length ? (
                      <div className="review-timeline-section">
                        <strong>打回子任务</strong>
                        <ul className="detail-list">
                          {entry.reworkTargets.map((t) => (
                            <li key={`${t.childTitle}-${t.instruction.slice(0, 24)}`}>
                              <em>{t.childTitle}</em>：{t.instruction}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {entry.verifyResults?.length ? (
                      <div className="review-timeline-section">
                        <strong>验证命令（compose:verify）</strong>
                        <ul className="review-verify-list">
                          {entry.verifyResults.map((v) => (
                            <li
                              key={v.command}
                              className={v.ok ? "ok" : "fail"}
                            >
                              <div className="review-verify-cmd">
                                <code>$ {v.command}</code>
                                <span>
                                  {v.timedOut
                                    ? "超时"
                                    : v.ok
                                      ? "通过"
                                      : `失败 (exit ${v.exitCode ?? "?"})`}
                                </span>
                              </div>
                              {v.stdout ? (
                                <pre className="detail-pre review-verify-out">{v.stdout}</pre>
                              ) : null}
                              {v.stderr ? (
                                <pre className="detail-pre review-verify-err">{v.stderr}</pre>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
