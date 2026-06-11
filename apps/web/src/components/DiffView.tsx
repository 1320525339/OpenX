import {
  collapseDiffContext,
  countDiffChanges,
  diffLineRows,
  type DiffLine,
} from "@openx/shared";

type Props = {
  before: string;
  after: string;
  compact?: boolean;
};

function DiffRow({
  line,
}: {
  line: DiffLine | { type: "ellipsis" };
}) {
  if (line.type === "ellipsis") {
    return <div className="diff-line ellipsis">…</div>;
  }
  const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
  return (
    <div className={`diff-line ${line.type}`}>
      <span className="diff-prefix" aria-hidden>
        {prefix}
      </span>
      <code className="diff-text">{line.text || " "}</code>
    </div>
  );
}

export function DiffView({ before, after, compact }: Props) {
  const rows = diffLineRows(before, after);
  const collapsed = collapseDiffContext(rows, compact ? 2 : 3);
  const { added, removed } = countDiffChanges(rows);

  if (added === 0 && removed === 0) {
    return <p className="delivery-preview-empty">文件内容无变化</p>;
  }

  return (
    <div className={`diff-view${compact ? " compact" : ""}`}>
      <div className="diff-stats">
        <span className="diff-stat add">+{added}</span>
        <span className="diff-stat remove">−{removed}</span>
      </div>
      <div className="diff-body">
        {collapsed.map((line, idx) => (
          <DiffRow key={idx} line={line} />
        ))}
      </div>
    </div>
  );
}
