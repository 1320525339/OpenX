import type { Goal } from "@openx/shared";
import type { DockMode } from "../../lib/use-desktop-layout";
import { WorkOrderIdBadge } from "../WorkOrderIdBadge";

type Props = {
  dockMode: DockMode;
  onDockModeChange: (mode: DockMode) => void;
  selectedGoal?: Goal;
  taskCount: number;
  awaitingReviewCount: number;
  /** @deprecated 施工桌面始终可进入，保留 prop 兼容旧调用 */
  artifactsEnabled?: boolean;
  onApprove?: () => void;
  onRework?: () => void;
  onStart?: () => void;
  approveEnabled?: boolean;
  startEnabled?: boolean;
  /** 默认显示全部；项目对话可隐藏「调度」 */
  visibleModes?: DockMode[];
};
const DOCK_ITEMS: { key: DockMode; label: string; icon: string }[] = [
  { key: "chat", label: "对话", icon: "💬" },
  { key: "tasks", label: "任务", icon: "📋" },
  { key: "artifacts", label: "施工", icon: "📦" },
  { key: "fleet", label: "执行器", icon: "⚙" },
];

export function ForemanDock({
  dockMode,
  onDockModeChange,
  selectedGoal,
  taskCount,
  awaitingReviewCount,
  onApprove,
  onRework,
  onStart,
  approveEnabled,
  startEnabled,
  visibleModes = ["chat", "tasks", "artifacts", "fleet"],
}: Props) {
  const dockItems = DOCK_ITEMS.filter((item) => visibleModes.includes(item.key));

  return (
    <footer className="foreman-dock" data-dock-mode={dockMode}>
      <div className="foreman-dock-modes" role="tablist" aria-label="工头底栏">
        {dockItems.map((item) => {
          const badge =
            item.key === "tasks" && taskCount > 0
              ? taskCount
              : item.key === "chat" && awaitingReviewCount > 0
                ? awaitingReviewCount
                : null;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={dockMode === item.key}
              className={`foreman-dock-btn${dockMode === item.key ? " active" : ""}`}
              onClick={() => onDockModeChange(item.key)}
            >
              <span className="foreman-dock-icon" aria-hidden>
                {item.icon}
              </span>
              <span className="foreman-dock-label">{item.label}</span>
              {badge != null && badge > 0 ? (
                <span className="foreman-dock-badge">{badge > 99 ? "99+" : badge}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="foreman-dock-context">
        {selectedGoal ? (
          <>
            <span className="foreman-dock-wo">
              {selectedGoal.orderNo > 0 ? (
                <WorkOrderIdBadge orderNo={selectedGoal.orderNo} />
              ) : (
                <span>{selectedGoal.id.slice(0, 8)}</span>
              )}
              <span>{selectedGoal.title}</span>
            </span>
            <div className="foreman-dock-actions">
              {startEnabled ? (
                <button type="button" className="btn compact" onClick={onStart}>
                  推进
                </button>
              ) : null}
              {approveEnabled ? (
                <button type="button" className="btn compact primary" onClick={onApprove}>
                  验收
                </button>
              ) : null}
              {selectedGoal.status === "awaiting_review" ||
              selectedGoal.status === "running" ? (
                <button type="button" className="btn compact" onClick={onRework}>
                  返工
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <span className="foreman-dock-hint">选择任务单以执行快捷操作</span>
        )}
      </div>
    </footer>
  );
}
