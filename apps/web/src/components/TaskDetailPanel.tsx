import { useState } from "react";
import type { Goal, GoalRunState } from "@openx/shared";
import { DEFAULT_MAX_ITERATIONS } from "@openx/shared";
import { api } from "../api";
import { executorDisplayLabel } from "../lib/executors";
import {
  buildGoalContext,
  formatDispatchSummary,
  goalStatusText,
  PRIORITY_LABELS,
} from "../lib/goal-detail";
import {
  formatGoalDurationShort,
  formatGoalSourceLabel,
} from "../lib/task-desk-pin";
import { resolveGoalDeliverables } from "../lib/goal-deliverables";
import { DeliveryChips } from "./DeliveryChips";
import { ReviewTimelineCompact } from "./ReviewTimelineCompact";
import { RunConsole } from "./RunConsole";
import { TaskSelectionSummary } from "./TaskSelectionSummary";
import { WorkOrderIdBadge } from "./WorkOrderIdBadge";

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
  conversationTitles?: Record<string, string>;
  /** pin 桌面卡片：聚焦状态/关系/验收与操作 */
  surface?: "page" | "pin";
};

function statusLabel(goal: Goal): string {
  return goalStatusText(goal);
}

function formatDuration(goal: Goal): string | null {
  const start = goal.createdAt;
  const end = goal.updatedAt;
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} 分钟`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hours} 小时 ${rem} 分` : `${hours} 小时`;
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
  conversationTitles,
  surface = "page",
}: Props) {
  const [reworkReason, setReworkReason] = useState("");
  const pinSurface = surface === "pin";

  if (editMode) {
    if (selectedGoals.length === 0) {
      return (
        <section className="mech-panel task-detail-panel">
          <div className="mech-panel-body panel-stack">
            <div className="panel-scroll empty-detail">
              <p className="empty-hint">勾选任务台中的目标，底部可批量启动、取消或删除</p>
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
            <p className="empty-hint">在任务台选择任务，查看状态、关系与验收操作</p>
          </div>
        </div>
      </section>
    );
  }

  const { parent, children, dependencies } = buildGoalContext(allGoals, goal);
  const duration = formatDuration(goal);
  const dispatchSummary = formatDispatchSummary(goal);
  const goalLogs = logs.filter((l) => l.goalId === goal.id).slice(-40);
  const recentLogs = goalLogs.slice(-6);
  const sourceLabel = formatGoalSourceLabel(goal, conversationTitles);
  const createdTime = new Date(goal.createdAt).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <section className={`mech-panel task-detail-panel${pinSurface ? " task-detail-panel-pin" : ""}`}>
      <div className="task-detail-hero">
        <div className="task-detail-hero-main">
          <WorkOrderIdBadge orderNo={goal.orderNo} className="goal-detail-order-id" />
          <h3 className="task-detail-title">{goal.title}</h3>
          {pinSurface ? (
            <span className={`status-pill ${goal.status} task-detail-hero-status`}>
              {statusLabel(goal)}
            </span>
          ) : null}
        </div>
        {!pinSurface ? (
        <div className="task-detail-hero-meta">
          <span className={`status-pill ${goal.status}`}>{statusLabel(goal)}</span>
          <span className="task-detail-meta-chip">{executorDisplayLabel(goal.executorId)}</span>
          {dispatchSummary ? (
            <span className="task-detail-meta-chip task-detail-meta-source" title={dispatchSummary}>
              {dispatchSummary.length > 28 ? `${dispatchSummary.slice(0, 28)}…` : dispatchSummary}
            </span>
          ) : null}
          {duration ? <span className="task-detail-meta-chip">耗时 {duration}</span> : null}
        </div>
        ) : null}
        {onOpenDetail && !pinSurface ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm task-detail-fullscreen"
            onClick={() => onOpenDetail(goal.id)}
          >
            全屏详情
          </button>
        ) : null}
      </div>

      <div className="mech-panel-body panel-stack">
        <div className="panel-scroll">
          {pinSurface ? (
            <div className="task-detail-metrics">
              <div className="task-detail-metric">
                <span className="task-detail-metric-label">执行器</span>
                <span className="task-detail-metric-value">{executorDisplayLabel(goal.executorId)}</span>
              </div>
              <div className="task-detail-metric">
                <span className="task-detail-metric-label">来源对话</span>
                <span className="task-detail-metric-value" title={sourceLabel}>
                  {sourceLabel}
                </span>
              </div>
              <div className="task-detail-metric">
                <span className="task-detail-metric-label">优先级</span>
                <span className="task-detail-metric-value">{PRIORITY_LABELS[goal.priority]}</span>
              </div>
              <div className="task-detail-metric">
                <span className="task-detail-metric-label">耗时</span>
                <span className="task-detail-metric-value">{formatGoalDurationShort(goal)}</span>
              </div>
              <div className="task-detail-metric">
                <span className="task-detail-metric-label">进度</span>
                <span className="task-detail-metric-value">{goal.progress}%</span>
              </div>
              <div className="task-detail-metric">
                <span className="task-detail-metric-label">自动重试</span>
                <span className="task-detail-metric-value">
                  {goal.iterationCount ?? 0} / {goal.maxIterations ?? DEFAULT_MAX_ITERATIONS}
                </span>
              </div>
              <div className="task-detail-metric">
                <span className="task-detail-metric-label">状态</span>
                <span className="task-detail-metric-value">{statusLabel(goal)}</span>
              </div>
              <div className="task-detail-metric">
                <span className="task-detail-metric-label">创建</span>
                <span className="task-detail-metric-value">{createdTime}</span>
              </div>
            </div>
          ) : null}
          {!pinSurface && run && (run.active || run.events.length > 0 || run.liveText) && (
            <div className="detail-block detail-run-block">
              <RunConsole run={run} />
            </div>
          )}

          {!pinSurface && dispatchSummary && (
            <div className="detail-block">
              <h4>派单上下文</h4>
              <p>{dispatchSummary}</p>
            </div>
          )}

          {!pinSurface ? (
          <div className="detail-grid task-detail-grid">
            <div className="detail-field">
              <span className="detail-label">进度</span>
              <div className="progress-bar">
                <span style={{ width: `${goal.progress}%` }} />
              </div>
              <span className="detail-value">{goal.progress}%</span>
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
          ) : null}

          {goal.acceptance && (
            <div className="detail-block task-detail-acceptance">
              <h4>验收标准</h4>
              <p>{goal.acceptance}</p>
            </div>
          )}

          {(parent || dependencies.length > 0 || children.length > 0) && (
            <div className="detail-block task-detail-relations">
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

          {pinSurface ? (
            <div className="detail-block task-detail-recent-logs">
              <h4>最近日志</h4>
              {recentLogs.length === 0 ? (
                <p className="settings-hint">暂无日志</p>
              ) : (
                <ul className="detail-log-list task-detail-log-compact">
                  {recentLogs.map((l, i) => (
                    <li key={`${l.timestamp}-${i}`} className={l.level}>
                      <time>{new Date(l.timestamp).toLocaleTimeString("zh-CN")}</time>
                      <span>{l.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {!pinSurface ? (
          <ReviewTimelineCompact
            goalId={goal.id}
            showFeedback={goal.status === "awaiting_review"}
            feedback={reworkReason}
            onFeedbackChange={setReworkReason}
            onApprove={
              goal.status === "awaiting_review"
                ? () => void onApprove(goal.id)
                : undefined
            }
            onRework={
              goal.status === "awaiting_review"
                ? (reason) => void onRework(goal.id, reason || undefined)
                : undefined
            }
            onTriggerReview={
              goal.status === "awaiting_review"
                ? () => void api.triggerGoalReview(goal.id, { force: true })
                : undefined
            }
          />
          ) : null}

          {!pinSurface && goal.userDraft && (
            <div className="detail-block">
              <h4>原始描述</h4>
              <pre className="detail-pre">{goal.userDraft}</pre>
            </div>
          )}

          {!pinSurface && (
            <div className="detail-block">
              <h4>执行提示词</h4>
              <pre className="detail-pre">{goal.executionPrompt}</pre>
            </div>
          )}

          {!pinSurface && goal.constraints.length > 0 && (
            <div className="detail-block">
              <h4>约束</h4>
              <ul className="detail-list">
                {goal.constraints.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}

          {!pinSurface && goal.reworkReason && (
            <div className="detail-block warn">
              <h4>返工原因</h4>
              <p>{goal.reworkReason}</p>
            </div>
          )}

          {!pinSurface && (goal.resultSummary || goal.deliverables?.length) && (() => {
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

          {!pinSurface && (
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
          )}
        </div>

        <div className={`panel-footer detail-actions${pinSurface ? " detail-actions-pin" : ""}`}>
          {(goal.status === "draft" || goal.status === "failed") && (
            <button type="button" className="btn primary" onClick={() => void onStart(goal.id)}>
              {goal.status === "failed" ? "重试" : "开始推进"}
            </button>
          )}
          {goal.status === "awaiting_review" && (
            <>
              <button
                type="button"
                className="btn primary"
                onClick={() => void onApprove(goal.id)}
              >
                确认完成
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void onRework(goal.id, reworkReason.trim() || undefined)}
              >
                提交返工
              </button>
            </>
          )}
          {pinSurface && onOpenDetail ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => onOpenDetail(goal.id)}
            >
              更多
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
