import { useEffect, useRef, useState } from "react";
import type { GoalRunState, RunStreamEvent } from "@openx/shared";
import { ChatMarkdown } from "../lib/chat-markdown";
import { buildToolRows } from "../lib/run-tool-rows";

type Props = {
  run: GoalRunState;
  /** 聊天流内紧凑展示 */
  compact?: boolean;
};

function statusLines(events: RunStreamEvent[], limit: number, hasThinking: boolean) {
  return events
    .filter((e): e is Extract<RunStreamEvent, { type: "status" }> => e.type === "status")
    .filter((e) => !(hasThinking && e.message.startsWith("思考 ›")))
    .slice(-limit);
}

export function RunConsole({ run, compact = false }: Props) {
  const textRef = useRef<HTMLDivElement>(null);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [thinkingTouched, setThinkingTouched] = useState(false);

  const thinkingText = run.thinkingText ?? "";
  const hasThinking = thinkingText.length > 0;

  useEffect(() => {
    const el = textRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [run.liveText, run.events.length, thinkingText]);

  useEffect(() => {
    if (run.active && hasThinking && !thinkingTouched) {
      setThinkingOpen(true);
    }
    if (!run.active && hasThinking) {
      setThinkingOpen(false);
      setThinkingTouched(false);
    }
  }, [run.active, hasThinking, thinkingTouched]);

  const tools = buildToolRows(run.events).slice(compact ? -3 : -8);
  const statuses = statusLines(run.events, compact ? 2 : 4, hasThinking);

  const toggleTool = (key: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className={`run-console${run.active ? " run-console-live" : ""}${compact ? " run-console-compact" : ""}`}>
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

      {hasThinking && (
        <details
          className="run-thinking-block"
          open={compact ? false : thinkingOpen}
          onToggle={(e) => {
            if (!compact) {
              const open = (e.target as HTMLDetailsElement).open;
              setThinkingOpen(open);
              setThinkingTouched(true);
            }
          }}
        >
          <summary className="run-thinking-summary">
            {run.active ? "思考中…" : `思考（${thinkingText.length} 字）`}
          </summary>
          {!compact && (
            <pre className="run-thinking-text">
              {thinkingText.length > 2000
                ? `…${thinkingText.slice(-2000)}`
                : thinkingText}
            </pre>
          )}
        </details>
      )}

      {statuses.length > 0 && (
        <ul className="run-status-list">
          {statuses.map((s, i) => (
            <li key={`${s.timestamp}-${i}`}>{s.message}</li>
          ))}
        </ul>
      )}

      {tools.length > 0 && (
        <ul className="run-tool-list">
          {tools.map((t) => {
            const expanded = expandedTools.has(t.key);
            const hasDetails = Boolean(t.argsPreview || t.outputPreview || t.resultPreview);
            return (
              <li
                key={t.key}
                className={`run-tool-item${t.running ? " running" : ""}${t.isError ? " error" : ""}`}
              >
                <div className="run-tool-item-head">
                  {t.running && <span className="run-pulse-dot tiny" aria-hidden />}
                  <span className="run-tool-name">{t.tool}</span>
                  <span className="run-tool-state">
                    {t.running ? "执行中" : t.isError ? "失败" : "完成"}
                  </span>
                  {!compact && hasDetails && (
                    <button
                      type="button"
                      className="btn compact linkish run-tool-expand"
                      onClick={() => toggleTool(t.key)}
                    >
                      {expanded ? "收起" : "详情"}
                    </button>
                  )}
                </div>
                {!compact && expanded && hasDetails && (
                  <div className="run-tool-details">
                    {t.argsPreview && (
                      <p>
                        <em>参数</em> {t.argsPreview}
                      </p>
                    )}
                    {t.outputPreview && (
                      <p>
                        <em>输出</em> {t.outputPreview}
                      </p>
                    )}
                    {t.resultPreview && (
                      <p>
                        <em>结果</em> {t.resultPreview}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {run.liveText ? (
        <div
          ref={textRef}
          className={`run-live-text${run.active ? "" : " run-live-markdown"}`}
        >
          {run.active ? (
            <pre className="run-live-text-pre">
              {compact && run.liveText.length > 600
                ? `…${run.liveText.slice(-600)}`
                : run.liveText}
            </pre>
          ) : (
            <ChatMarkdown
              text={
                compact && run.liveText.length > 600
                  ? `…${run.liveText.slice(-600)}`
                  : run.liveText
              }
            />
          )}
        </div>
      ) : run.active ? (
        <p className="run-waiting">等待 Agent 输出…</p>
      ) : null}
    </div>
  );
}
