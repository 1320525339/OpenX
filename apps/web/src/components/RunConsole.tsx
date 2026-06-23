import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { GoalRunState, RunStreamEvent } from "@openx/shared";
import { ChatMarkdown } from "../lib/chat-markdown";
import { groupToolDisplayItems } from "../lib/run-tool-groups";
import { splitShellPreview } from "../lib/run-tool-present";
import { buildToolRows, type ToolRunRow } from "../lib/run-tool-rows";
import { formatThinkingDisplay, thinkingSummaryLabel } from "../lib/thinking-display";

const LazyToolDiffView = lazy(() =>
  import("./ToolDiffView").then((m) => ({ default: m.ToolDiffView })),
);

type Props = {
  run: GoalRunState;
  /** 聊天流内紧凑展示 */
  compact?: boolean;
  /** 嵌入对话流任务单：活动流样式 */
  taskOrder?: boolean;
  /** 活动流前缀，如 Pi */
  agentShortName?: string;
};

function statusLines(events: RunStreamEvent[], limit: number, hasThinking: boolean) {
  return events
    .filter((e): e is Extract<RunStreamEvent, { type: "status" }> => e.type === "status")
    .filter((e) => !(hasThinking && e.message.startsWith("思考 ›")))
    .slice(-limit);
}

function RunToolDetails({ row }: { row: ToolRunRow }) {
  return (
    <div className="run-tool-details">
      {row.argsPreview && (
        <p>
          <em>参数</em> {row.argsPreview}
        </p>
      )}
      {row.outputPreview && (
        <p>
          <em>输出</em> {row.outputPreview}
        </p>
      )}
      {row.resultPreview && (
        <p>
          <em>结果</em> {row.resultPreview}
        </p>
      )}
    </div>
  );
}

function RunShellPreview({ text }: { text: string }) {
  const [showAll, setShowAll] = useState(false);
  const { preview, hasMore, totalLines } = splitShellPreview(text);
  const shown = showAll ? text : preview;
  return (
    <div className="run-tool-shell">
      <pre className="run-tool-shell-pre">{shown}</pre>
      {hasMore && !showAll && (
        <button type="button" className="btn compact linkish run-tool-shell-more" onClick={() => setShowAll(true)}>
          显示全部（{totalLines} 行）
        </button>
      )}
    </div>
  );
}

function RunToolItem({
  row,
  compact,
  expanded,
  onToggle,
  taskOrder,
  agentShortName,
}: {
  row: ToolRunRow;
  compact: boolean;
  expanded: boolean;
  onToggle: () => void;
  taskOrder?: boolean;
  agentShortName?: string;
}) {
  const hasDetails = Boolean(row.argsPreview || row.outputPreview || row.resultPreview);
  const shellText = row.isShell ? row.outputPreview || row.resultPreview : undefined;
  const showInlineShell = shellText && !expanded;

  return (
    <li
      className={`run-tool-item${row.running ? " running" : ""}${row.isError ? " error" : ""}${row.readOnly && !row.running ? " quiet" : ""}${taskOrder ? " run-feed-item" : ""}`}
    >
      {taskOrder ? (
        <div className="run-feed-item-head">
          <span className="run-feed-agent">{agentShortName ?? "Agent"}</span>
          <span className="run-feed-kind">
            {row.running ? `工具调用 ${row.tool}` : row.isError ? "工具失败" : "工具结果"}
          </span>
          {row.summary ? <span className="run-feed-summary">{row.summary}</span> : null}
          <span className="run-feed-state">
            {row.running ? "运行中" : row.isError ? "失败" : "成功"}
          </span>
          {hasDetails && (
            <button type="button" className="btn compact linkish run-tool-expand" onClick={onToggle}>
              {expanded ? "收起" : "展开原文"}
            </button>
          )}
        </div>
      ) : (
        <div className="run-tool-item-head">
          {row.running && <span className="run-pulse-dot tiny" aria-hidden />}
          <span className="run-tool-name">{row.tool}</span>
          {row.subject && <span className="run-tool-subject">{row.subject}</span>}
          {row.summary && <span className="run-tool-summary">{row.summary}</span>}
          <span className="run-tool-state">
            {row.running ? "执行中" : row.isError ? "失败" : "完成"}
          </span>
          {hasDetails && (
            <button type="button" className="btn compact linkish run-tool-expand" onClick={onToggle}>
              {expanded ? "收起" : "详情"}
            </button>
          )}
        </div>
      )}
      {expanded && hasDetails && <RunToolDetails row={row} />}
      {row.fileDiff && (expanded || !compact) && (
        <Suspense fallback={<pre className="tool-diff-body tool-diff-loading">加载 diff…</pre>}>
          <LazyToolDiffView fileDiff={row.fileDiff} defaultOpen={row.running} maxHeight={260} />
        </Suspense>
      )}
      {showInlineShell && <RunShellPreview text={shellText} />}
      {compact && !expanded && !shellText && row.outputPreview && (
        <p className="run-tool-output-compact">{row.outputPreview}</p>
      )}
    </li>
  );
}

function RunReadOnlyBatch({
  label,
  rows,
  compact,
}: {
  label: string;
  rows: ToolRunRow[];
  compact: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="run-tool-batch">
      <button
        type="button"
        className="run-tool-batch-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="run-tool-batch-label">{label}</span>
        <span className="run-tool-batch-hint">{open ? "收起" : "展开"}</span>
      </button>
      {open && (
        <ul className="run-tool-batch-list">
          {rows.map((row) => (
            <li key={row.key} className="run-tool-batch-item">
              <span className="run-tool-name">{row.tool}</span>
              {row.subject && <span className="run-tool-subject">{row.subject}</span>}
              {row.summary && <span className="run-tool-summary">{row.summary}</span>}
            </li>
          ))}
        </ul>
      )}
      {!open && compact && rows.length > 0 && (
        <p className="run-tool-batch-compact">{rows[rows.length - 1]?.subject}</p>
      )}
    </li>
  );
}

export function RunConsole({
  run,
  compact = false,
  taskOrder = false,
  agentShortName = "Agent",
}: Props) {
  const textRef = useRef<HTMLDivElement>(null);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [thinkingTouched, setThinkingTouched] = useState(false);

  const thinkingText = run.thinkingText ?? "";
  const hasThinking = thinkingText.length > 0;
  const thinkingShown = formatThinkingDisplay(thinkingText, { compact });

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

  const toolRows = buildToolRows(run.events).slice(compact ? -8 : -12);
  const toolItems = groupToolDisplayItems(toolRows);
  const statuses = statusLines(run.events, compact ? 3 : 4, hasThinking);

  const toggleTool = (key: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div
      className={`run-console${run.active ? " run-console-live" : ""}${compact ? " run-console-compact" : ""}${taskOrder ? " run-console-task-order" : ""}`}
    >
      {!taskOrder && (
        <div className="run-console-head">
          {run.active ? (
            <>
              <span className="run-pulse-dot" aria-hidden />
              <span className="run-console-title">Agent 正在执行</span>
            </>
          ) : (
            <span className="run-console-title">执行记录</span>
          )}
          {run.executorId && <span className="run-console-meta">{run.executorId}</span>}
        </div>
      )}

      {hasThinking && (
        <details
          className={`run-thinking-block${taskOrder ? " run-feed-item" : ""}`}
          open={compact ? run.active || thinkingOpen : thinkingOpen}
          onToggle={(e) => {
            const open = (e.target as HTMLDetailsElement).open;
            setThinkingOpen(open);
            setThinkingTouched(true);
          }}
        >
          <summary className={`run-thinking-summary${taskOrder ? " run-feed-item-head" : ""}`}>
            {taskOrder ? (
              <>
                <span className="run-feed-agent">{agentShortName}</span>
                <span className="run-feed-kind">
                  {run.active ? "思考中" : thinkingSummaryLabel(thinkingText, false)}
                </span>
              </>
            ) : (
              thinkingSummaryLabel(thinkingText, run.active)
            )}
          </summary>
          <pre className={`run-thinking-text${compact ? " compact" : ""}`}>{thinkingShown}</pre>
        </details>
      )}

      {statuses.length > 0 && (
        <ul className="run-status-list">
          {statuses.map((s, i) => (
            <li key={`${s.timestamp}-${i}`}>{s.message}</li>
          ))}
        </ul>
      )}

      {toolItems.length > 0 && (
        <ul className="run-tool-list">
          {toolItems.map((item) => {
            if (item.kind === "readonly-batch") {
              return (
                <RunReadOnlyBatch
                  key={item.rows.map((r) => r.key).join("-")}
                  label={item.label}
                  rows={item.rows}
                  compact={compact}
                />
              );
            }
            const row = item.row;
            return (
              <RunToolItem
                key={row.key}
                row={row}
                compact={compact}
                expanded={expandedTools.has(row.key)}
                onToggle={() => toggleTool(row.key)}
                taskOrder={taskOrder}
                agentShortName={agentShortName}
              />
            );
          })}
        </ul>
      )}

      {run.liveText ? (
        <div
          ref={textRef}
          className={`run-live-text${run.active ? "" : " run-live-markdown"}${taskOrder ? " run-feed-item" : ""}`}
        >
          {taskOrder ? (
            <div className="run-feed-item-head run-feed-reply-head">
              <span className="run-feed-agent">{agentShortName}</span>
              <span className="run-feed-kind">{run.active ? "正在输出…" : "回复"}</span>
            </div>
          ) : null}
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
        <p className={`run-waiting${taskOrder ? " run-feed-waiting" : ""}`}>
          {taskOrder ? `${agentShortName} 正在输出…` : "等待 Agent 输出…"}
        </p>
      ) : null}
    </div>
  );
}
