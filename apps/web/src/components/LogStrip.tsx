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
  expanded?: boolean;
  onToggleExpand?: () => void;
};

const LEVELS = ["all", "info", "warn", "error"] as const;

function LogLine({ entry }: { entry: LogEntry }) {
  return (
    <>
      <time>{new Date(entry.timestamp).toLocaleTimeString("zh-CN")}</time>
      <em>{entry.level.toUpperCase()}</em>
      {entry.message}
    </>
  );
}

export function LogStrip({
  logs,
  selectedGoalId,
  selectedGoalTitle,
  sseStatus,
  expanded = false,
  onToggleExpand,
}: Props) {
  const [scope, setScope] = useState<"selected" | "all">("selected");
  const [levelFilter, setLevelFilter] = useState<(typeof LEVELS)[number]>("all");
  const [pauseScroll, setPauseScroll] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scoped =
    scope === "selected" && selectedGoalId
      ? logs.filter((l) => l.goalId === selectedGoalId)
      : logs;

  const filtered =
    levelFilter === "all"
      ? scoped
      : scoped.filter((l) => l.level.toLowerCase() === levelFilter);

  const latest = filtered[filtered.length - 1];
  const display = filtered.slice(-120);

  const contextLabel =
    scope === "selected" && selectedGoalTitle
      ? `正在关注：${selectedGoalTitle}`
      : scope === "selected"
        ? "当前目标动态"
        : "全部动态";

  useEffect(() => {
    if (!expanded || pauseScroll) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [display.length, expanded, pauseScroll]);

  const sseLabel =
    sseStatus === "connected"
      ? "实时"
      : sseStatus === "reconnecting"
        ? "重连"
        : "断开";

  return (
    <footer className={`log-strip${expanded ? " expanded" : ""}`}>
      <div className="log-strip-bar">
        <span className={`log-strip-sse ${sseStatus}`}>{sseLabel}</span>
        <span className="log-strip-label">{contextLabel}</span>

        {!expanded && (
          <div className="log-strip-preview">
            {latest ? (
              <span className={`log-strip-line ${latest.level.toLowerCase()}`}>
                <LogLine entry={latest} />
              </span>
            ) : (
              <span className="log-strip-empty">还没有新的进展…</span>
            )}
          </div>
        )}

        {expanded && (
          <div className="log-strip-filters">
            <button
              type="button"
              className={`log-strip-chip${scope === "selected" ? " active" : ""}`}
              onClick={() => setScope("selected")}
              disabled={!selectedGoalId}
            >
              当前目标
            </button>
            <button
              type="button"
              className={`log-strip-chip${scope === "all" ? " active" : ""}`}
              onClick={() => setScope("all")}
            >
              全部
            </button>
            {LEVELS.map((lv) => (
              <button
                key={lv}
                type="button"
                className={`log-strip-chip${levelFilter === lv ? " active" : ""}`}
                onClick={() => setLevelFilter(lv)}
              >
                {lv === "all" ? "类型" : lv.toUpperCase()}
              </button>
            ))}
            <button
              type="button"
              className={`log-strip-chip${pauseScroll ? " active" : ""}`}
              onClick={() => setPauseScroll((p) => !p)}
            >
              {pauseScroll ? "继续更新" : "暂停滚动"}
            </button>
          </div>
        )}

        {onToggleExpand && (
          <button type="button" className="log-strip-toggle" onClick={onToggleExpand}>
            {expanded ? "收起" : "展开"}
          </button>
        )}
      </div>

      {expanded && (
        <div
          ref={scrollRef}
          className={`log-strip-body vertical${pauseScroll ? " paused" : ""}`}
        >
          {display.length === 0 ? (
            <span className="log-strip-empty">还没有新的进展…</span>
          ) : (
            display.map((l, i) => (
              <span
                key={`${l.timestamp}-${i}`}
                className={`log-strip-line ${l.level.toLowerCase()}`}
              >
                <LogLine entry={l} />
              </span>
            ))
          )}
        </div>
      )}
    </footer>
  );
}
