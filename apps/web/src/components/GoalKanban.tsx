import { useMemo, useState } from "react";
import type { Goal } from "@openx/shared";
import {
  goalDisplayHint,
  goalDisplayLabel,
  goalDisplayOutcome,
} from "@openx/shared";
import { buildKanbanColumns } from "../lib/goal-kanban-columns";
import { useWideKanban } from "../lib/use-wide-kanban";
import { executorDisplayLabel } from "../lib/executors";
import { WorkOrderIdBadge } from "./WorkOrderIdBadge";

type Props = {
  goals: Goal[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenDetail?: (id: string) => void;
  conversationTitles?: Record<string, string>;
};

function KanbanColumnView({
  col,
  selectedId,
  onSelect,
  onOpenDetail,
  conversationTitles,
}: {
  col: ReturnType<typeof buildKanbanColumns>[number];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenDetail?: (id: string) => void;
  conversationTitles?: Record<string, string>;
}) {
  return (
    <section className={`goal-kanban-column goal-kanban-${col.key}`}>
      <header className="goal-kanban-column-head">
        <h4 className="goal-kanban-column-title">{col.title}</h4>
        <span className="goal-kanban-column-meta">
          {col.goals.length} · {col.hint}
        </span>
      </header>
      <ul className="goal-kanban-cards">
        {col.goals.map((g) => {
          const hint = goalDisplayHint(g);
          return (
            <li key={g.id}>
              <button
                type="button"
                className={`goal-kanban-card${selectedId === g.id ? " selected" : ""}`}
                onClick={() => onSelect(g.id)}
                onDoubleClick={() => onOpenDetail?.(g.id)}
              >
                <div className="goal-kanban-card-top">
                  {g.orderNo > 0 ? (
                    <WorkOrderIdBadge orderNo={g.orderNo} />
                  ) : (
                    <span className="goal-kanban-card-id">{g.id.slice(0, 6)}</span>
                  )}
                  <span
                    className={`status-pill compact outcome-${goalDisplayOutcome(g)}`}
                  >
                    {goalDisplayLabel(g)}
                  </span>
                </div>
                <strong className="goal-kanban-card-title">{g.title}</strong>
                {conversationTitles?.[g.conversationId] ? (
                  <span className="goal-kanban-card-conv">
                    {conversationTitles[g.conversationId]}
                  </span>
                ) : null}
                <span className="goal-kanban-card-meta">
                  {g.progress}% · {executorDisplayLabel(g.executorId)}
                  {hint ? ` · ${hint}` : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function GoalKanban({
  goals,
  selectedId,
  onSelect,
  onOpenDetail,
  conversationTitles,
}: Props) {
  const wide = useWideKanban();
  const columns = useMemo(() => buildKanbanColumns(goals), [goals]);
  const [activeTab, setActiveTab] = useState(columns[0]?.key ?? "incomplete");

  const activeColumn = columns.find((c) => c.key === activeTab) ?? columns[0];

  if (goals.length === 0) {
    return <p className="empty-hint">还没有任务单。</p>;
  }

  if (!wide) {
    return (
      <div className="goal-kanban goal-kanban-tabbed">
        <div className="goal-kanban-tabs filter-tabs" role="tablist" aria-label="看板列">
          {columns.map((col) => (
            <button
              key={col.key}
              type="button"
              role="tab"
              aria-selected={activeTab === col.key}
              className={activeTab === col.key ? "active" : ""}
              onClick={() => setActiveTab(col.key)}
            >
              {col.title}
              {col.goals.length > 0 ? ` (${col.goals.length})` : ""}
            </button>
          ))}
        </div>
        {activeColumn ? (
          <KanbanColumnView
            col={activeColumn}
            selectedId={selectedId}
            onSelect={onSelect}
            onOpenDetail={onOpenDetail}
            conversationTitles={conversationTitles}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="goal-kanban goal-kanban-wide">
      {columns.map((col) => (
        <KanbanColumnView
          key={col.key}
          col={col}
          selectedId={selectedId}
          onSelect={onSelect}
          onOpenDetail={onOpenDetail}
          conversationTitles={conversationTitles}
        />
      ))}
    </div>
  );
}
