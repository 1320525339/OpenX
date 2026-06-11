import { useState } from "react";
import type { Goal, GoalRunState } from "@openx/shared";
import { executorDisplayLabel } from "../lib/executors";
import { buildGoalContext, formatDispatchSummary, goalStatusText } from "../lib/goal-detail";
import { resolveGoalDeliverables } from "../lib/goal-deliverables";
import { DeliveryChips } from "./DeliveryChips";
import { ReviewTimeline } from "./ReviewTimeline";
import { RunConsole } from "./RunConsole";
import { TaskSelectionSummary } from "./TaskSelectionSummary";

type LogEntry = {
  goalId: string;
  level: string;
  message: string;
  timestamp: string;
};

type Props = {
  goal: Goal | undefined;
  allGoals?: Goal[];
  editMode: boolean;
  selectedGoals: Goal[];
  logs: LogEntry[];
  run?: GoalRunState;
  onApprove: (id: string) => Promise<void>;
  onRework: (id: string, reason?: string) => Promise<void>;
  onStart: (id: string) => Promise<void>;
  onOpenDetail?: (id: string) => void;
};

function statusLabel(goal: Goal): string {
  return goalStatusText(goal);
}

export function TaskDetailPanel({
  goal,
  allGoals = [],
  editMode,
  selectedGoals,
  logs,
  run,
  onApprove,
  onRework,
  onStart,
  onOpenDetail,
}: Props) {
  const [approveOpen, setApproveOpen] = useState(false);
  const [reworkOpen, setReworkOpen] = useState(false);
  const [reworkReason, setReworkReason] = useState("");

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
  const { parent, children, dependencies } = buildGoalContext(allGoals, goal);

  return (
    <section className="mech-panel task-detail-panel">
      <div className="mech-panel-head">
        <h3>{goal.title}</h3>
        <div className="detail-head-actions">
          {onOpenDetail && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onOpenDetail(goal.id)}
            >
              全屏详情
            </button>
          )}
          <span className={`status-pill ${goal.status}`}>{statusLabel(goal)}</span>
        </div>
      </div>
      <div className="mech-panel-body panel-stack">
        <div className="panel-scroll">
          {run && (run.active || run.events.length > 0 || run.liveText) && (
            <div className="detail-block detail-run-block">
              <RunConsole run={run} />
            </div>
          )}

          {formatDispatchSummary(goal) && (
            <div className="detail-block">
              <h4>派单上下文</h4>
              <p>{formatDispatchSummary(goal)}</p>
            </div>
          )}

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

          {(parent || dependencies.length > 0 || children.length > 0) && (
            <div className="detail-block">
              <h4>任务关系</h4>
              {parent ? <p>所属：{parent.title}</p> : null}
              {dependencies.length > 0 ? (
                <p>等待：{dependencies.map((d) => d.title).join("、")}</p>
              ) : null}
              {children.length > 0 ? (
                <ul className="detail-list">
                  {children.map((c) => (
                    <li key={c.id}>{c.title}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}

          <ReviewTimeline goal={goal} />

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

          {(goal.resultSummary || goal.deliverables?.length) && (() => {
            const deliverables = resolveGoalDeliverables(goal);
            return (
              <div className="detail-block highlight">
                <h4>{deliverables.length > 0 ? "交付物" : "执行结果"}</h4>
                {deliverables.length > 0 && <DeliveryChips items={deliverables} />}
                {goal.resultSummary && (
                  <pre className="detail-pre">{goal.resultSummary}</pre>
                )}
              </div>
            );
          })()}

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
              {goal.status === "failed" ? "重试" : "开始推进"}
            </button>
          )}
          {goal.status === "awaiting_review" && !approveOpen && !reworkOpen && (
            <>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  setApproveOpen(true);
                  setReworkOpen(false);
                }}
              >
                确认完成
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  setReworkOpen(true);
                  setApproveOpen(false);
                  setReworkReason("");
                }}
              >
                还要修改
              </button>
            </>
          )}
          {approveOpen && (
            <div className="approve-confirm">
              <p>你之前说「做好」的标准：{goal.acceptance || "（未填写）"}</p>
              <div className="goal-actions">
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    void onApprove(goal.id);
                    setApproveOpen(false);
                  }}
                >
                  确认已经做好
                </button>
                <button type="button" className="btn" onClick={() => setApproveOpen(false)}>
                  取消
                </button>
              </div>
            </div>
          )}
          {reworkOpen && (
            <div className="rework-box">
              <textarea
                className="mech-textarea"
                rows={2}
                placeholder="想让它怎么改？（可选）"
                value={reworkReason}
                onChange={(e) => setReworkReason(e.target.value)}
              />
              <div className="goal-actions">
                <button
                  type="button"
                  className="btn danger"
                  onClick={() => {
                    void onRework(goal.id, reworkReason.trim() || undefined);
                    setReworkOpen(false);
                  }}
                >
                  提交返工
                </button>
                <button type="button" className="btn" onClick={() => setReworkOpen(false)}>
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
