import type { Goal } from "@openx/shared";
import { goalsEligibleForAction, statusBreakdown } from "../lib/goal-batch";

type Props = {
  goals: Goal[];
};

export function TaskSelectionSummary({ goals }: Props) {
  const breakdown = statusBreakdown(goals);
  const startN = goalsEligibleForAction(goals, "start").length;
  const cancelN = goalsEligibleForAction(goals, "cancel").length;
  const approveN = goalsEligibleForAction(goals, "approve").length;

  return (
    <section className="mech-panel task-detail-panel selection-summary-panel">
      <div className="mech-panel-head">
        <h3>已选 {goals.length} 项</h3>
        <span className="coach-badge">编辑模式</span>
      </div>
      <div className="mech-panel-body panel-stack">
        <div className="panel-scroll">
          {breakdown.length > 0 && (
            <div className="selection-status-row">
              {breakdown.map(({ label, count }) => (
                <span key={label} className="selection-status-chip">
                  {label} {count}
                </span>
              ))}
            </div>
          )}

          <div className="detail-block">
            <h4>可执行操作</h4>
            <ul className="selection-action-hints">
              {startN > 0 && <li>开始推进：{startN} 项（草稿 / 失败）</li>}
              {cancelN > 0 && <li>取消任务：{cancelN} 项（进行中）</li>}
              {approveN > 0 && <li>确认完成：{approveN} 项（待确认）</li>}
              <li>删除：{goals.length} 项（彻底移除，含子目标）</li>
              {startN === 0 && cancelN === 0 && approveN === 0 && (
                <li className="muted">当前选中项无批量启动/取消/确认操作，可删除</li>
              )}
            </ul>
          </div>

          <div className="detail-block">
            <h4>选中列表</h4>
            <ul className="selection-title-list">
              {goals.slice(0, 12).map((g) => (
                <li key={g.id}>{g.title}</li>
              ))}
              {goals.length > 12 && (
                <li className="muted">…等共 {goals.length} 项</li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
