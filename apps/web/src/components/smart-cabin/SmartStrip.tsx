import type { Goal } from "@openx/shared";
import { goalDisplayLabel } from "@openx/shared";
import type { DesktopScene } from "../../lib/use-desktop-layout";
import { WorkOrderIdBadge } from "../WorkOrderIdBadge";

type Props = {
  title: string;
  subtitle?: string;
  scene: DesktopScene;
  sceneLabel: string;
  onSceneChange: (scene: DesktopScene) => void;
  selectedGoal?: Goal;
  awaitingReviewCount: number;
  executorOnlineCount: number;
  executorTotalCount: number;
  totalGoals: number;
};

const SCENES: { key: DesktopScene; label: string }[] = [
  { key: "dispatch", label: "调度桌面" },
  { key: "planning", label: "派单桌面" },
  { key: "execution", label: "施工桌面" },
];

export function SmartStrip({
  title,
  subtitle,
  scene,
  sceneLabel,
  onSceneChange,
  selectedGoal,
  awaitingReviewCount,
  executorOnlineCount,
  executorTotalCount,
  totalGoals,
}: Props) {
  return (
    <header className="smart-strip">
      <div className="smart-strip-main">
        <div className="smart-strip-titles">
          <h2 className="smart-strip-title">{title}</h2>
          {subtitle ? <span className="smart-strip-subtitle">{subtitle}</span> : null}
        </div>
        <div className="smart-strip-scene">
          <span className="smart-strip-scene-label">{sceneLabel}</span>
          <select
            className="smart-strip-scene-select"
            value={scene}
            aria-label="切换桌面场景"
            onChange={(e) => onSceneChange(e.target.value as DesktopScene)}
          >
            {SCENES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="smart-strip-stats">
        {selectedGoal ? (
          <span className="smart-strip-chip smart-strip-chip-wo">
            {selectedGoal.orderNo > 0 ? (
              <WorkOrderIdBadge orderNo={selectedGoal.orderNo} />
            ) : null}
            <span className="smart-strip-chip-text">{selectedGoal.title}</span>
            <span className="smart-strip-chip-meta">
              {goalDisplayLabel(selectedGoal)} · {selectedGoal.progress}%
            </span>
          </span>
        ) : (
          <span className="smart-strip-chip muted">未选任务</span>
        )}
        <span className="smart-strip-stat">
          待验收 <strong>{awaitingReviewCount}</strong>
        </span>
        <span className="smart-strip-stat">
          执行器 <strong>{executorOnlineCount}</strong>/{executorTotalCount}
        </span>
        <span className="smart-strip-stat">
          任务单 <strong>{totalGoals}</strong>
        </span>
      </div>
    </header>
  );
}
