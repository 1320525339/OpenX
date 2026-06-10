import { useEffect, useRef } from "react";
import type { GoalRunState, RunStreamEvent } from "@openx/shared";

type Props = {
  run: GoalRunState;
};

function toolRows(events: RunStreamEvent[]) {
  const rows: Array<{ tool: string; running: boolean; isError?: boolean }> = [];
  for (const e of events) {
    if (e.type === "tool.start") {
      rows.push({ tool: e.tool, running: true });
    }
    if (e.type === "tool.end") {
      const last = [...rows].reverse().find((r) => r.tool === e.tool && r.running);
      if (last) {
        last.running = false;
        last.isError = e.isError;
      } else {
        rows.push({ tool: e.tool, running: false, isError: e.isError });
      }
    }
  }
  return rows.slice(-6);
}

export function RunConsole({ run }: Props) {
  const textRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = textRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [run.liveText, run.events.length]);

  const tools = toolRows(run.events);
  const statusLines = run.events
    .filter((e): e is Extract<RunStreamEvent, { type: "status" }> => e.type === "status")
    .slice(-4);

  return (
    <div className={`run-console${run.active ? " run-console-live" : ""}`}>
      <div className="run-console-head">
        {run.active ? (
          <>
            <span className="run-pulse-dot" aria-hidden />
            <span className="run-console-title">Agent 正在执行</span>
          </>
        ) : (
          <span className="run-console-title">执行记录</span>
        )}
        {run.executorId && (
          <span className="run-console-meta">{run.executorId}</span>
        )}
      </div>

      {statusLines.length > 0 && (
        <ul className="run-status-list">
          {statusLines.map((s, i) => (
            <li
              key={`${s.timestamp}-${i}`}
              className={s.message.startsWith("思考 ›") ? "run-thought" : undefined}
            >
              {s.message}
            </li>
          ))}
        </ul>
      )}

      {tools.length > 0 && (
        <ul className="run-tool-list">
          {tools.map((t, i) => (
            <li
              key={`${t.tool}-${i}`}
              className={`run-tool-item${t.running ? " running" : ""}${t.isError ? " error" : ""}`}
            >
              {t.running && <span className="run-pulse-dot tiny" aria-hidden />}
              <span className="run-tool-name">{t.tool}</span>
              <span className="run-tool-state">
                {t.running ? "执行中" : t.isError ? "失败" : "完成"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {run.liveText ? (
        <pre ref={textRef} className="run-live-text">
          {run.liveText}
        </pre>
      ) : run.active ? (
        <p className="run-waiting">等待 Agent 输出…</p>
      ) : null}
    </div>
  );
}
