import { useEffect, useRef, useState } from "react";

type LogEntry = {
  goalId: string;
  level: string;
  message: string;
  timestamp: string;
};

type SseStatus = "connected" | "reconnecting" | "disconnected";

type Props = {
  logs: LogEntry[];
  selectedGoalId: string | null;
  selectedGoalTitle?: string;
  sseStatus: SseStatus;
};

const LEVELS = ["all", "info", "warn", "error"] as const;

export function LogsPanel({
  logs,
  selectedGoalId,
  selectedGoalTitle,
  sseStatus,
}: Props) {
  const [scope, setScope] = useState<"selected" | "all">("selected");
  const [levelFilter, setLevelFilter] = useState<(typeof LEVELS)[number]>("all");
  const [pauseScroll, setPauseScroll] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const scoped =
    scope === "selected" && selectedGoalId
      ? logs.filter((l) => l.goalId === selectedGoalId)
      : logs;

  const filtered =
    levelFilter === "all"
      ? scoped
      : scoped.filter((l) => l.level.toLowerCase() === levelFilter);

  const display = filtered.slice(-120);

  useEffect(() => {
    if (!pauseScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [display.length, pauseScroll]);

  const sseLabel =
    sseStatus === "connected"
      ? "● 实时"
      : sseStatus === "reconnecting"
        ? "◐ 重连中"
        : "○ 已断开";

  return (
    <section className="mech-panel">
      <div className="mech-panel-head">
        <h3>日志</h3>
        <span className={`sse-badge ${sseStatus}`}>{sseLabel}</span>
      </div>
      <div className="mech-panel-body panel-stack">
        <div className="logs-toolbar">
          <button
            type="button"
            className={`filter-chip${scope === "selected" ? " active" : ""}`}
            onClick={() => setScope("selected")}
            disabled={!selectedGoalId}
            title={selectedGoalTitle}
          >
            当前目标
          </button>
          <button
            type="button"
            className={`filter-chip${scope === "all" ? " active" : ""}`}
            onClick={() => setScope("all")}
          >
            全部
          </button>
          {LEVELS.map((lv) => (
            <button
              key={lv}
              type="button"
              className={`filter-chip${levelFilter === lv ? " active" : ""}`}
              onClick={() => setLevelFilter(lv)}
            >
              {lv === "all" ? "级别" : lv.toUpperCase()}
            </button>
          ))}
          <button
            type="button"
            className={`filter-chip${pauseScroll ? " active" : ""}`}
            onClick={() => setPauseScroll((p) => !p)}
          >
            {pauseScroll ? "继续滚动" : "暂停滚动"}
          </button>
        </div>

        {scope === "selected" && selectedGoalTitle && (
          <p className="t-meta" style={{ marginBottom: "0.35rem" }}>
            聚焦：{selectedGoalTitle}
          </p>
        )}
        {scope === "selected" && !selectedGoalId && (
          <p className="t-meta" style={{ marginBottom: "0.35rem" }}>
            选择任务可聚焦执行轨迹
          </p>
        )}

        <div className={`logs-body panel-scroll${pauseScroll ? " paused" : ""}`}>
          {display.length === 0 && (
            <span style={{ color: "var(--text-dim)" }}>等待日志…</span>
          )}
          {display.map((l, i) => (
            <div key={`${l.timestamp}-${i}`} className={`log-line ${l.level.toLowerCase()}`}>
              [{new Date(l.timestamp).toLocaleTimeString("zh-CN")}] [{l.level.toUpperCase()}]{" "}
              {l.message}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
    </section>
  );
}
