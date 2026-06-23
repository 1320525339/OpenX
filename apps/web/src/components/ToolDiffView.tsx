import { useMemo, useState } from "react";
import type { ToolFileDiff } from "@openx/shared";
import {
  collapseDiffDisplayContext,
  diffDisplayRows,
  diffRowsFromUnifiedDiff,
} from "@openx/shared";
import { highlightLangFromPath } from "../lib/code-highlight-lang";
import { ReasonixDiffView } from "../vendor-seams/reasonix/diff-view";
import { reasonixInlineDiffClipboard } from "../vendor-seams/reasonix/inline-diff";

type Props = {
  fileDiff: ToolFileDiff;
  defaultOpen?: boolean;
  maxHeight?: number;
};

function CopyDiffButton({
  rows,
  fallback,
  fullDiff,
}: {
  rows: ReturnType<typeof diffRowsFromUnifiedDiff>;
  fallback: string;
  fullDiff: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async (mode: "body" | "full") => {
    const text = mode === "full" ? fullDiff : reasonixInlineDiffClipboard(rows) || fallback;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <button
      type="button"
      className="tool-diff-copy"
      aria-label="复制 diff"
      title={copied ? "已复制" : "复制 diff，按住 Alt 复制完整 unified diff"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void copy(e.altKey ? "full" : "body");
      }}
    >
      {copied ? "已复制" : "复制"}
    </button>
  );
}

/** RunConsole 工具 diff — Reasonix HljsDiff seam */
export function ToolDiffView({ fileDiff, defaultOpen = false, maxHeight = 260 }: Props) {
  const rows = useMemo(
    () => collapseDiffDisplayContext(diffRowsFromUnifiedDiff(fileDiff.diff), 2),
    [fileDiff.diff],
  );
  const language = highlightLangFromPath(fileDiff.path);

  return (
    <details className="tool-diff-view" open={defaultOpen || undefined}>
      <summary className="tool-diff-summary">
        {fileDiff.path ? <span className="tool-diff-path">{fileDiff.path}</span> : null}
        <span className="tool-diff-badges">
          {fileDiff.added > 0 && (
            <span className="tool-diff-badge tool-diff-badge-add">+{fileDiff.added}</span>
          )}
          {fileDiff.removed > 0 && (
            <span className="tool-diff-badge tool-diff-badge-del">−{fileDiff.removed}</span>
          )}
        </span>
        <CopyDiffButton rows={rows} fallback={fileDiff.diff} fullDiff={fileDiff.diff} />
      </summary>
      <ReasonixDiffView rows={rows} language={language} maxHeight={maxHeight} />
    </details>
  );
}

export function ToolInlineDiffView({
  before,
  after,
  path,
  maxHeight = 260,
}: {
  before: string;
  after: string;
  path?: string;
  maxHeight?: number;
}) {
  const rows = useMemo(
    () => collapseDiffDisplayContext(diffDisplayRows(before, after), 2),
    [before, after],
  );
  const language = highlightLangFromPath(path);
  const { added, removed } = useMemo(() => {
    let a = 0;
    let r = 0;
    for (const row of rows) {
      if (row.type === "add") a += 1;
      if (row.type === "del") r += 1;
    }
    return { added: a, removed: r };
  }, [rows]);

  return (
    <div className="tool-diff-view tool-diff-inline">
      {path ? (
        <div className="tool-diff-summary tool-diff-summary-static">
          <span className="tool-diff-path">{path}</span>
          <span className="tool-diff-badges">
            {added > 0 && <span className="tool-diff-badge tool-diff-badge-add">+{added}</span>}
            {removed > 0 && (
              <span className="tool-diff-badge tool-diff-badge-del">−{removed}</span>
            )}
          </span>
        </div>
      ) : null}
      <ReasonixDiffView rows={rows} language={language} maxHeight={maxHeight} />
    </div>
  );
}
