import { useEffect } from "react";
import type { Goal, GoalRunState } from "@openx/shared";
import { TaskDetailPanel } from "./TaskDetailPanel";

type LogEntry = {
  goalId: string;
  level: string;
  message: string;
  timestamp: string;
};

type Props = {
  goal: Goal | undefined;
  logs: LogEntry[];
  run?: GoalRunState;
  allGoals?: Goal[];
  onBack: () => void;
  onApprove: (id: string) => Promise<void>;
  onRework: (id: string, reason?: string) => Promise<void>;
  onStart: (id: string) => Promise<void>;
};

export function GoalDetailPage({
  goal,
  logs,
  run,
  allGoals = [],
  onBack,
  onApprove,
  onRework,
  onStart,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  return (
    <div className="main-view goal-detail-page">
      <header className="goal-detail-page-head">
        <button type="button" className="btn btn-ghost goal-detail-back" onClick={onBack}>
          ← 返回看板
        </button>
        {goal ? (
          <span className="goal-detail-page-subtitle">{goal.title}</span>
        ) : (
          <span className="goal-detail-page-subtitle muted">目标不存在或已删除</span>
        )}
      </header>
      <div className="goal-detail-page-body workspace-pane">
        <TaskDetailPanel
          goal={goal}
          allGoals={allGoals}
          editMode={false}
          selectedGoals={[]}
          logs={logs}
          run={run}
          onApprove={onApprove}
          onRework={onRework}
          onStart={onStart}
        />
      </div>
    </div>
  );
}
