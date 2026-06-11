import { useEffect, useState } from "react";
import { api } from "../api";
import type { GoalDeliverable } from "../lib/goal-deliverables";
import { DiffView } from "./DiffView";

type Props = {
  items: GoalDeliverable[];
  compact?: boolean;
  onOpenFile?: (path: string) => void;
};

type ViewMode = "preview" | "diff";

function actionLabel(action?: "created" | "modified"): string | null {
  if (action === "created") return "新建";
  if (action === "modified") return "修改";
  return null;
}

function FilePreviewPanel({
  item,
  compact,
  onOpenFile,
}: {
  item: Extract<GoalDeliverable, { kind: "file" }>;
  compact?: boolean;
  onOpenFile?: (path: string) => void;
}) {
  const canDiff = Boolean(item.previousContent);
  const [viewMode, setViewMode] = useState<ViewMode>(canDiff ? "diff" : "preview");
  const [content, setContent] = useState(item.preview ?? "");
  const [loading, setLoading] = useState(!item.preview && viewMode === "preview");
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (item.preview || viewMode === "diff") {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.filePreview(item.path);
        if (cancelled) return;
        if (res.ok) {
          setContent(res.content);
          setTruncated(res.truncated);
        } else {
          setError("无法读取文件预览");
        }
      } catch {
        if (!cancelled) setError("无法读取文件预览");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item.path, item.preview, viewMode]);

  useEffect(() => {
    if (item.preview) setContent(item.preview);
  }, [item.preview]);

  const openFile = async () => {
    if (onOpenFile) {
      onOpenFile(item.path);
      return;
    }
    try {
      await api.openInIde(item.path);
    } catch {
      /* ignore */
    }
  };

  const badge = actionLabel(item.action);
  const afterContent = item.preview ?? content;

  return (
    <div className={`delivery-preview${compact ? " compact" : ""}`}>
      <div className="delivery-preview-head">
        <span className="delivery-preview-path" title={item.path}>
          {item.label ?? item.path}
        </span>
        {badge && <span className={`delivery-action-badge ${item.action}`}>{badge}</span>}
        {item.language && (
          <span className="delivery-lang-badge">{item.language}</span>
        )}
        {canDiff && (
          <div className="delivery-view-toggle" role="tablist" aria-label="预览模式">
            <button
              type="button"
              className={viewMode === "diff" ? "active" : ""}
              onClick={() => setViewMode("diff")}
            >
              Diff
            </button>
            <button
              type="button"
              className={viewMode === "preview" ? "active" : ""}
              onClick={() => setViewMode("preview")}
            >
              全文
            </button>
          </div>
        )}
        <button type="button" className="btn compact" onClick={() => void openFile()}>
          在 IDE 打开
        </button>
      </div>

      {viewMode === "diff" && item.previousContent && (
        <DiffView
          before={item.previousContent}
          after={afterContent || ""}
          compact={compact}
        />
      )}

      {viewMode === "preview" && (
        <>
          {loading && <p className="delivery-preview-loading">加载预览…</p>}
          {error && <p className="delivery-preview-error">{error}</p>}
          {!loading && !error && afterContent && (
            <pre className={`delivery-preview-code language-${item.language ?? "text"}`}>
              <code>{afterContent}</code>
            </pre>
          )}
          {truncated && (
            <p className="delivery-preview-truncated">内容已截断，请在 IDE 中查看完整文件</p>
          )}
        </>
      )}
    </div>
  );
}

export function DeliveryChips({ items, compact, onOpenFile }: Props) {
  const [activeFile, setActiveFile] = useState<string | null>(null);

  if (items.length === 0) return null;

  const openFile = async (path: string) => {
    if (onOpenFile) {
      onOpenFile(path);
      return;
    }
    try {
      await api.openInIde(path);
    } catch {
      /* ignore */
    }
  };

  const activeFileItem = items.find(
    (i): i is Extract<GoalDeliverable, { kind: "file" }> =>
      i.kind === "file" && i.path === activeFile,
  );

  return (
    <div className={`delivery-chips-wrap${compact ? " compact" : ""}`}>
      <div className={`delivery-chips${compact ? " compact" : ""}`}>
        {items.map((item, idx) => {
          if (item.kind === "file") {
            const selected = activeFile === item.path;
            const badge = actionLabel(item.action);
            const hasDiff = Boolean(item.previousContent);
            return (
              <button
                key={`f-${item.path}-${idx}`}
                type="button"
                className={`delivery-chip file${selected ? " active" : ""}`}
                title={item.path}
                onClick={() => setActiveFile(selected ? null : item.path)}
              >
                <span className="delivery-chip-icon" aria-hidden>
                  📄
                </span>
                <span className="delivery-chip-label">{item.label ?? item.path}</span>
                {badge && (
                  <span className={`delivery-chip-action ${item.action}`}>{badge}</span>
                )}
                {hasDiff && <span className="delivery-chip-diff">diff</span>}
              </button>
            );
          }
          if (item.kind === "link") {
            return (
              <a
                key={`l-${item.url}-${idx}`}
                className="delivery-chip link"
                href={item.url}
                target="_blank"
                rel="noreferrer"
              >
                {item.label ?? item.url}
              </a>
            );
          }
          return (
            <details key={`s-${idx}`} className="delivery-chip snippet" open={!compact}>
              <summary>
                {item.label ?? "代码片段"}
                {item.language && (
                  <span className="delivery-lang-badge inline">{item.language}</span>
                )}
              </summary>
              <pre className={`delivery-preview-code language-${item.language ?? "text"}`}>
                <code>{item.code}</code>
              </pre>
            </details>
          );
        })}
      </div>

      {activeFileItem && (
        <FilePreviewPanel
          item={activeFileItem}
          compact={compact}
          onOpenFile={onOpenFile ?? ((p) => void openFile(p))}
        />
      )}
    </div>
  );
}
