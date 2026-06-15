import type { Goal } from "@openx/shared";
import { formatWorkOrderId, goalDisplayLabel, goalDisplayOutcome, goalMatchesDisplayFilter } from "@openx/shared";
import { WorkOrderIdBadge } from "../WorkOrderIdBadge";

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "incomplete", label: "未完成" },
  { key: "failed", label: "失败" },
  { key: "done", label: "已完成" },
  { key: "rework", label: "返工中" },
];

type Props = {
  goals: Goal[];
  filter: string;
  onFilterChange: (filter: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  totalCount: number;
};

export function TaskIndexCard({
  goals,
  filter,
  onFilterChange,
  selectedId,
  onSelect,
  totalCount,
}: Props) {
  const filtered = goals.filter((g) => goalMatchesDisplayFilter(g, filter));

  return (
    <div className="smart-card task-index-card">
      <header className="smart-card-head">
        <h3 className="smart-card-title">任务索引</h3>
        <span className="smart-card-meta">{totalCount} 项</span>
      </header>

      <div className="task-index-filters" role="tablist" aria-label="任务筛选">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={filter === f.key}
            className={`task-index-filter${filter === f.key ? " active" : ""}`}
            onClick={() => onFilterChange(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <ul className="task-index-list panel-scroll">
        {filtered.length === 0 ? (
          <li className="empty-hint">没有匹配的任务单</li>
        ) : (
          filtered.map((g) => (
            <li key={g.id}>
              <button
                type="button"
                className={`task-index-item${selectedId === g.id ? " selected" : ""}`}
                onClick={() => onSelect(g.id)}
              >
                <span className="task-index-item-top">
                  {g.orderNo > 0 ? (
                    <WorkOrderIdBadge orderNo={g.orderNo} />
                  ) : (
                    <span className="task-index-id">{g.id.slice(0, 6)}</span>
                  )}
                  <span className={`status-pill compact outcome-${goalDisplayOutcome(g)}`}>
                    {goalDisplayLabel(g)}
                  </span>
                </span>
                <span className="task-index-title">{g.title}</span>
                {g.orderNo > 0 ? (
                  <span className="task-index-wo">{formatWorkOrderId(g.orderNo)}</span>
                ) : null}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
