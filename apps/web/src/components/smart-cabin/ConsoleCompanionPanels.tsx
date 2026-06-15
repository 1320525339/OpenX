import type { Goal } from "@openx/shared";
import { WorkOrderIdBadge } from "../WorkOrderIdBadge";

type Props = {
  goals: Goal[];
  onSelect: (id: string) => void;
};

export function AwaitingReviewCompanion({ goals, onSelect }: Props) {
  if (goals.length === 0) {
    return (
      <div className="smart-card companion-card">
        <header className="smart-card-head">
          <h3 className="smart-card-title">待验收</h3>
        </header>
        <p className="smart-card-hint">暂无待验收任务</p>
      </div>
    );
  }

  return (
    <div className="smart-card companion-card">
      <header className="smart-card-head">
        <h3 className="smart-card-title">待验收</h3>
        <span className="smart-card-meta">{goals.length} 项</span>
      </header>
      <ul className="companion-review-list panel-scroll">
        {goals.map((g) => (
          <li key={g.id}>
            <button type="button" className="companion-review-item" onClick={() => onSelect(g.id)}>
              {g.orderNo > 0 ? <WorkOrderIdBadge orderNo={g.orderNo} /> : null}
              <span>{g.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SelectedGoalCompanion({ goal }: { goal: Goal }) {
  return (
    <div className="smart-card companion-card">
      <header className="smart-card-head">
        <h3 className="smart-card-title">当前任务</h3>
      </header>
      <div className="companion-goal-detail">
        {goal.orderNo > 0 ? <WorkOrderIdBadge orderNo={goal.orderNo} /> : null}
        <strong>{goal.title}</strong>
        <p className="companion-goal-meta">
          {goal.orderNo > 0 ? `WO-${String(goal.orderNo).padStart(6, "0")}` : goal.id.slice(0, 8)}
          {" · "}
          {goal.progress}%
        </p>
        {goal.acceptance?.trim() ? (
          <p className="companion-goal-acceptance">{goal.acceptance.trim().slice(0, 200)}</p>
        ) : null}
      </div>
    </div>
  );
}
