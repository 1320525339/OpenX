import type { Goal } from "@openx/shared";
import { GOAL_STATUS_LABELS } from "@openx/shared";
import { executorDisplayLabel } from "../lib/executors";
import { TaskSelectionSummary } from "./TaskSelectionSummary";

type LogEntry = {
  goalId: string;
  level: string;
  message: string;
  timestamp: string;
};

type Props = {
  goal: Goal | undefined;
  editMode: boolean;
  selectedGoals: Goal[];
  logs: LogEntry[];
  onApprove: (id: string) => Promise<void>;
  onRework: (id: string, reason?: string) => Promise<void>;
  onStart: (id: string) => Promise<void>;
};

function statusLabel(goal: Goal): string {
  if (goal.effectStatus === "rework") return "需要返工";
  return GOAL_STATUS_LABELS[goal.status] ?? goal.status;
}

export function TaskDetailPanel({
  goal,
  editMode,
  selectedGoals,
  logs,
  onApprove,
  onRework,
  onStart,
}: Props) {
  if (editMode) {
    if (selectedGoals.length === 0) {
      return (
        <section className="mech-panel task-detail-panel">
          <div className="mech-panel-body panel-stack">
            <div className="panel-scroll empty-detail">
              <p className="empty-hint">勾选左侧目标，底部可批量启动、取消或删除</p>
            </div>
          </div>
        </section>
      );
    }
    return <TaskSelectionSummary goals={selectedGoals} />;
  }

  if (!goal) {
    return (
      <section className="mech-panel task-detail-panel">
        <div className="mech-panel-body panel-stack">
          <div className="panel-scroll empty-detail">
            <p className="empty-hint">选择左侧任务查看详情、执行结果与历史日志</p>
          </div>
        </div>
      </section>
    );
  }

  const goalLogs = logs.filter((l) => l.goalId === goal.id).slice(-40);

  return (
    <section className="mech-panel task-detail-panel">
      <div className="mech-panel-head">
        <h3>{goal.title}</h3>
        <span className={`status-pill ${goal.status}`}>{statusLabel(goal)}</span>
      </div>
      <div className="mech-panel-body panel-stack">
        <div className="panel-scroll">
          <div className="detail-grid">
            <div className="detail-field">
              <span className="detail-label">进度</span>
              <div className="progress-bar">
                <span style={{ width: `${goal.progress}%` }} />
              </div>
              <span className="detail-value">{goal.progress}%</span>
            </div>
            <div className="detail-field">
              <span className="detail-label">执行器</span>
              <span className="detail-value">{executorDisplayLabel(goal.executorId)}</span>
            </div>
            <div className="detail-field">
              <span className="detail-label">创建</span>
              <span className="detail-value">
                {new Date(goal.createdAt).toLocaleString("zh-CN")}
              </span>
            </div>
            <div className="detail-field">
              <span className="detail-label">更新</span>
              <span className="detail-value">
                {new Date(goal.updatedAt).toLocaleString("zh-CN")}
              </span>
            </div>
          </div>

          {goal.acceptance && (
            <div className="detail-block">
              <h4>验收标准</h4>
              <p>{goal.acceptance}</p>
            </div>
          )}

          {goal.userDraft && (
            <div className="detail-block">
              <h4>原始描述</h4>
              <pre className="detail-pre">{goal.userDraft}</pre>
            </div>
          )}

          <div className="detail-block">
            <h4>执行提示词</h4>
            <pre className="detail-pre">{goal.executionPrompt}</pre>
          </div>

          {goal.constraints.length > 0 && (
            <div className="detail-block">
              <h4>约束</h4>
              <ul className="detail-list">
                {goal.constraints.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          {goal.resultSummary && (
            <div className="detail-block highlight">
              <h4>执行结果</h4>
              <pre className="detail-pre">{goal.resultSummary}</pre>
            </div>
          )}

          {goal.reworkReason && (
            <div className="detail-block warn">
              <h4>返工原因</h4>
              <p>{goal.reworkReason}</p>
            </div>
          )}

          <div className="detail-block">
            <h4>执行日志 ({goalLogs.length})</h4>
            {goalLogs.length === 0 ? (
              <p className="settings-hint">暂无日志</p>
            ) : (
              <ul className="detail-log-list">
                {goalLogs.map((l, i) => (
                  <li key={`${l.timestamp}-${i}`} className={l.level}>
                    <time>{new Date(l.timestamp).toLocaleTimeString("zh-CN")}</time>
                    <em>{l.level}</em>
                    {l.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="panel-footer detail-actions">
          {(goal.status === "draft" || goal.status === "failed") && (
            <button type="button" className="btn primary" onClick={() => void onStart(goal.id)}>
              开始推进
            </button>
          )}
          {goal.status === "awaiting_review" && (
            <>
              <button type="button" className="btn primary" onClick={() => void onApprove(goal.id)}>
                确认完成
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  const reason = window.prompt("想让它怎么改？（可选）") ?? undefined;
                  void onRework(goal.id, reason || undefined);
                }}
              >
                还要修改
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
