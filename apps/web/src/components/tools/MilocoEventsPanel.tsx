import { useCallback, useEffect, useState } from "react";
import { laneToEventLabel } from "@openx/shared";
import { api, connectEvents, type MilocoEventItem } from "../../api";

const LANE_FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "全部" },
  { value: "miloco-interactive", label: "语音/交互" },
  { value: "miloco-suggest", label: "感知建议" },
  { value: "miloco-rule", label: "规则触发" },
];

const STATUS_LABEL: Record<string, string> = {
  queued: "排队中",
  accepted: "已受理",
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
  needs_attention: "待确认",
  awaiting_review: "待验收",
  done: "已完成",
  draft: "草稿",
  cancelled: "已取消",
  timeout: "超时",
  ok: "成功",
  error: "错误",
};

function statusClass(status: string): string {
  if (status === "succeeded" || status === "done" || status === "ok") return "ok";
  if (status === "failed" || status === "error" || status === "cancelled") return "fail";
  if (status === "needs_attention" || status === "awaiting_review") return "warn";
  return "pending";
}

type Props = {
  onOpenGoal?: (goalId: string) => void;
  pollMs?: number;
  limit?: number;
};

export function MilocoEventsPanel({ onOpenGoal, pollMs = 0, limit = 50 }: Props) {
  const [events, setEvents] = useState<MilocoEventItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [laneFilter, setLaneFilter] = useState("");

  const refresh = useCallback(async () => {
    try {
      const res = await api.getMilocoEvents(limit, laneFilter || undefined);
      setEvents(res.goals ?? res.runs ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [limit, laneFilter]);

  useEffect(() => {
    void refresh();
    const disconnect = connectEvents({
      onEvent: (e) => {
        if (e.type === "integration.run.updated") void refresh();
      },
    });
    const timer =
      pollMs > 0 ? setInterval(() => void refresh(), pollMs) : undefined;
    return () => {
      disconnect();
      if (timer) clearInterval(timer);
    };
  }, [refresh, pollMs]);

  if (error) return <p className="form-error">{error}</p>;

  return (
    <>
      <div className="miloco-events-filters">
        <label className="settings-hint" htmlFor="miloco-events-lane">
          事件类型
        </label>
        <select
          id="miloco-events-lane"
          className="settings-input"
          value={laneFilter}
          onChange={(e) => setLaneFilter(e.target.value)}
        >
          {LANE_FILTERS.map((f) => (
            <option key={f.value || "all"} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>
      {events.length === 0 ? (
        <p className="settings-hint">尚无感知或自动化事件。接入完成后，事件将显示在此。</p>
      ) : (
        <ul className="miloco-events-timeline">
          {events.map((e) => {
            const openId = e.goalId;
            return (
              <li key={e.id} className="miloco-event-row">
                <span className="miloco-event-lane">
                  {e.lane ? laneToEventLabel(e.lane) : "感知"}
                </span>
                <span className={`miloco-goal-status ${statusClass(e.status)}`}>
                  {STATUS_LABEL[e.status] ?? e.status}
                </span>
                {onOpenGoal && openId ? (
                  <button
                    type="button"
                    className="miloco-event-link"
                    onClick={() => onOpenGoal(openId)}
                  >
                    {e.title}
                  </button>
                ) : (
                  <span>{e.title}</span>
                )}
                <time className="miloco-event-time" dateTime={e.createdAt}>
                  {new Date(e.createdAt).toLocaleString()}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
