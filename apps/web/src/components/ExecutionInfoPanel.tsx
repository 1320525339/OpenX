import { useEffect, useRef, useState } from "react";
import type { Goal, GoalRunState } from "@openx/shared";
import { ExecGoalChip } from "./ExecGoalChip";
import { getRunState } from "../lib/run-state";
import { goalStatusText } from "../lib/goal-detail";

type LogEntry = {
  goalId: string;
  level: string;
  message: string;
  timestamp: string;
};

type Props = {
  goals: Goal[];
  selectedGoal?: Goal;
  logs: LogEntry[];
  runs: Record<string, GoalRunState>;
  onHydrateRun: (goalId: string) => Promise<void>;
  onSelectGoal: (id: string) => void;
  onOpenTasks: (goalId?: string) => void;
  onApprove: (id: string) => Promise<boolean>;
  onRework: (id: string, reason?: string) => Promise<boolean>;
  onStart: (id: string) => Promise<boolean>;
  onCancel: (id: string) => Promise<boolean>;
};

function taskSortWeight(goal: Goal): number {
  if (goal.status === "running") return 0;
  if (goal.status === "awaiting_review") return 1;
  if (goal.status === "failed") return 2;
  if (goal.status === "draft") return 3;
  if (goal.status === "done") return 4;
  return 5;
}

function sortTaskList(goals: Goal[]): Goal[] {
  return [...goals]
    .sort(
      (a, b) =>
        taskSortWeight(a) - taskSortWeight(b) ||
        b.updatedAt.localeCompare(a.updatedAt),
    )
    .slice(0, 24);
}

export function ExecutionInfoPanel({
  goals,
  selectedGoal,
  logs,
  runs,
  onHydrateRun,
  onSelectGoal,
  onOpenTasks,
  onApprove,
  onRework,
  onStart,
  onCancel,
}: Props) {
  const logBottomRef = useRef<HTMLDivElement>(null);
  const taskList = sortTaskList(goals);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const recentLogs = selectedGoal
    ? logs.filter((l) => l.goalId === selectedGoal.id).slice(-14)
    : logs.slice(-14);

  useEffect(() => {
    if (selectedGoal?.id && expandedId !== selectedGoal.id) {
      setExpandedId(selectedGoal.id);
    }
  }, [selectedGoal?.id]);

  useEffect(() => {
    logBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [recentLogs.length, selectedGoal?.id]);

  const toggleGoal = (id: string) => {
    onSelectGoal(id);
    setExpandedId((prev) => (prev === id ? null : id));
    void onHydrateRun(id);
  };

  const selectRelated = (id: string) => {
    onSelectGoal(id);
    setExpandedId(id);
    void onHydrateRun(id);
  };

  const runAction = async (id: string, fn: () => Promise<boolean | void>) => {
    setBusyId(id);
    try {
      await fn();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <aside className="execution-info-panel mech-panel">
      <div className="mech-panel-head">
        <h3>执行动态</h3>
        <button type="button" className="btn linkish" onClick={() => onOpenTasks()}>
          全部任务 →
        </button>
      </div>
      <div className="mech-panel-body exec-panel-layout">
        <div className="exec-tasks-region panel-scroll">
          <p className="exec-section-label exec-section-label-first">任务列表 ({taskList.length})</p>
          {taskList.length === 0 ? (
            <p className="settings-hint">暂无任务，点击侧栏「＋ 新目标」创建</p>
          ) : (
            taskList.map((g) => (
              <ExecGoalChip
                key={g.id}
                goal={g}
                run={getRunState(runs, g.id)}
                allGoals={goals}
                active={selectedGoal?.id === g.id}
                expanded={expandedId === g.id}
                busy={busyId === g.id}
                onToggle={() => toggleGoal(g.id)}
                onApprove={() => void runAction(g.id, () => onApprove(g.id))}
                onRework={(reason) => void runAction(g.id, () => onRework(g.id, reason))}
                onStart={() => void runAction(g.id, () => onStart(g.id))}
                onCancel={() => void runAction(g.id, () => onCancel(g.id))}
                onOpenDetail={() => onOpenTasks(g.id)}
                onSelectRelated={selectRelated}
              />
            ))
          )}
        </div>

        <div className="exec-logs-region">
          <p className="exec-section-label">
            最近日志
            {selectedGoal ? ` · ${selectedGoal.title}` : ""}
          </p>
          <div className="exec-log-scroll panel-scroll">
            {recentLogs.length === 0 ? (
              <p className="settings-hint">暂无执行日志</p>
            ) : (
              <ul className="exec-log-list">
                {recentLogs.map((l, i) => (
                  <li key={`${l.timestamp}-${i}`} className={`exec-log-line ${l.level}`}>
                    <time>{new Date(l.timestamp).toLocaleTimeString("zh-CN")}</time>
                    {l.message}
                  </li>
                ))}
                <div ref={logBottomRef} />
              </ul>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

export { goalStatusText };
