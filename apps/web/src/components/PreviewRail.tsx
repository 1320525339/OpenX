import { useMemo } from "react";
import type { Goal, GoalRunState } from "@openx/shared";
import { goalStatusText } from "../lib/goal-detail";
import { resolveGoalDeliverables } from "../lib/goal-deliverables";
import { DeliveryChips } from "./DeliveryChips";
import { RunConsole } from "./RunConsole";
import { WorkOrderIdBadge } from "./WorkOrderIdBadge";

type Props = {
  goal?: Goal;
  run?: GoalRunState;
  goals: Goal[];
  onSelectGoal?: (id: string) => void;
};

export function PreviewRail({ goal, run, goals, onSelectGoal }: Props) {
  const deliverables = useMemo(
    () => (goal ? resolveGoalDeliverables(goal) : []),
    [goal],
  );

  const awaitingReview = useMemo(
    () => goals.filter((g) => g.status === "awaiting_review"),
    [goals],
  );

  if (!goal) {
    return (
      <aside className="preview-rail preview-rail-empty">
        <div className="preview-rail-head">
          <h3 className="preview-rail-title">产物预览</h3>
        </div>
        <p className="preview-rail-hint">
          选择左侧任务，或等待执行产出后，这里会显示文件预览与 Diff。
        </p>
        {awaitingReview.length > 0 ? (
          <div className="preview-rail-section">
            <p className="preview-rail-section-label">待验收</p>
            <ul className="preview-rail-quick-list">
              {awaitingReview.slice(0, 6).map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    className="preview-rail-quick-item"
                    onClick={() => onSelectGoal?.(g.id)}
                  >
                    {g.orderNo > 0 ? (
                      <WorkOrderIdBadge orderNo={g.orderNo} />
                    ) : null}
                    <span>{g.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </aside>
    );
  }

  return (
    <aside className="preview-rail">
      <div className="preview-rail-head">
        <div className="preview-rail-head-main">
          {goal.orderNo > 0 ? <WorkOrderIdBadge orderNo={goal.orderNo} /> : null}
          <h3 className="preview-rail-title">{goal.title}</h3>
        </div>
        <span className="preview-rail-meta">
          {goalStatusText(goal)} · {goal.progress}%
        </span>
      </div>

      {run && (run.active || run.events.length > 0 || run.liveText) ? (
        <div className="preview-rail-section">
          <p className="preview-rail-section-label">执行过程</p>
          <RunConsole run={run} compact />
        </div>
      ) : null}

      <div className="preview-rail-section preview-rail-deliverables">
        <p className="preview-rail-section-label">
          交付物{deliverables.length > 0 ? ` · ${deliverables.length}` : ""}
        </p>
        {deliverables.length === 0 ? (
          <p className="preview-rail-hint">
            {goal.status === "running"
              ? "执行中，产物将在这里出现。"
              : goal.resultSummary?.trim()
                ? goal.resultSummary.trim().slice(0, 400)
                : "暂无结构化交付物。"}
          </p>
        ) : (
          <DeliveryChips items={deliverables} />
        )}
      </div>

      {goal.acceptance?.trim() ? (
        <div className="preview-rail-section">
          <p className="preview-rail-section-label">验收标准</p>
          <p className="preview-rail-acceptance">{goal.acceptance}</p>
        </div>
      ) : null}
    </aside>
  );
}
