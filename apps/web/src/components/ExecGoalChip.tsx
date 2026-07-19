import { useState, type ReactNode } from "react";
import type { Goal, GoalRunState } from "@openx/shared";
import { RunConsole } from "./RunConsole";
import { CrewDialogueSummary } from "./CrewDialogueSummary";
import { GoalProgressBar, GoalStatusPill } from "./GoalCardPrimitives";
import { executorDisplayLabel } from "../lib/executors";
import {
  buildGoalContext,
  goalStatusText,
  PRIORITY_LABELS,
  truncate,
} from "../lib/goal-detail";
import { WorkOrderIdBadge } from "./WorkOrderIdBadge";

type Props = {
  goal: Goal;
  run: GoalRunState;
  allGoals: Goal[];
  active: boolean;
  expanded: boolean;
  busy?: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onRework: (reason?: string) => void;
  onStart: () => void;
  onCancel: () => void;
  onOpenDetail: () => void;
  onSelectRelated?: (id: string) => void;
};

function DetailBlock({
  label,
  children,
  warn,
}: {
  label: string;
  children: ReactNode;
  warn?: boolean;
}) {
  if (!children) return null;
  return (
    <div className={`exec-goal-detail-section${warn ? " warn" : ""}`}>
      <p className="exec-goal-detail-label">{label}</p>
      {children}
    </div>
  );
}

function DetailText({ text, max = 320 }: { text?: string; max?: number }) {
  if (!text?.trim()) return null;
  return <p className="exec-goal-detail-text">{truncate(text, max)}</p>;
}

export function ExecGoalChip({
  goal,
  run,
  allGoals,
  active,
  expanded,
  busy,
  onToggle,
  onApprove,
  onRework,
  onStart,
  onCancel,
  onOpenDetail,
  onSelectRelated,
}: Props) {
  const [reworkDraft, setReworkDraft] = useState("");
  const [showRework, setShowRework] = useState(false);
  const { parent, children, dependencies } = buildGoalContext(allGoals, goal);
  const statusText = goalStatusText(goal);
  const isWorking = goal.status === "running" && (run.active || goal.progress < 100);

  const canCancel = !["done", "cancelled"].includes(goal.status);
  const canApprove = goal.status === "awaiting_review";
  const canStart = goal.status === "draft" || goal.status === "failed";
  const canRework = goal.status === "awaiting_review";

  return (
    <div className={`exec-goal-item${expanded ? " expanded" : ""}${isWorking ? " working" : ""}`}>
      <button
        type="button"
        className={`exec-goal-chip${active ? " active" : ""}${isWorking ? " working" : ""}`}
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className="exec-goal-chip-top">
          <span className="exec-goal-title">
            {isWorking && <span className="run-pulse-dot chip-dot" aria-hidden />}
            <WorkOrderIdBadge orderNo={goal.orderNo} className="exec-goal-order-id" />
            {goal.title}
          </span>
          <GoalStatusPill goal={goal} variant="status" compact />
        </span>
        <span className="exec-goal-meta">
          {goal.progress}% · {executorDisplayLabel(goal.executorId)}
        </span>
        {goal.status === "running" && (
          <GoalProgressBar progress={goal.progress} className="exec-goal-progress" />
        )}
      </button>

      {expanded && (
        <div className="exec-goal-detail">
          {(run.active || run.events.length > 0 || run.liveText) && (
            <RunConsole run={run} />
          )}

          <CrewDialogueSummary goalId={goal.id} crewStatus={goal.crewStatus} />

          <details className="exec-goal-brief">
            <summary>任务 brief</summary>
            <div className="exec-goal-detail-section">
              <dl className="exec-detail-kv">
                {goal.orderNo > 0 && (
                  <div>
                    <dt>任务单号</dt>
                    <dd>
                      <WorkOrderIdBadge orderNo={goal.orderNo} />
                    </dd>
                  </div>
                )}
                <div>
                  <dt>状态</dt>
                  <dd>{statusText}</dd>
                </div>
                <div>
                  <dt>进度</dt>
                  <dd>{goal.progress}%</dd>
                </div>
                <div>
                  <dt>执行器</dt>
                  <dd>{executorDisplayLabel(goal.executorId)}</dd>
                </div>
                <div>
                  <dt>优先级</dt>
                  <dd>{PRIORITY_LABELS[goal.priority]}</dd>
                </div>
                {goal.effectStatus && (
                  <div>
                    <dt>验收</dt>
                    <dd>{goal.effectStatus === "approved" ? "已通过" : "需返工"}</dd>
                  </div>
                )}
                <div>
                  <dt>更新</dt>
                  <dd>{new Date(goal.updatedAt).toLocaleString("zh-CN")}</dd>
                </div>
              </dl>
            </div>

            {parent && (
              <DetailBlock label="所属核心目标">
                <button
                  type="button"
                  className="exec-related-link"
                  onClick={() => onSelectRelated?.(parent.id)}
                >
                  {parent.title}
                  <span className="exec-related-meta"> · {goalStatusText(parent)}</span>
                </button>
              </DetailBlock>
            )}

            {dependencies.length > 0 && (
              <DetailBlock label="依赖任务">
                <ul className="exec-related-list">
                  {dependencies.map((dep) => (
                    <li key={dep.id}>
                      <button
                        type="button"
                        className="exec-related-link"
                        onClick={() => onSelectRelated?.(dep.id)}
                      >
                        {dep.title}
                        <span className="exec-related-meta"> · {goalStatusText(dep)} · {dep.progress}%</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </DetailBlock>
            )}

            {children.length > 0 && (
              <DetailBlock label={`子任务 (${children.length})`}>
                <ul className="exec-related-list">
                  {children.map((child) => (
                    <li key={child.id}>
                      <button
                        type="button"
                        className="exec-related-link"
                        onClick={() => onSelectRelated?.(child.id)}
                      >
                        {child.title}
                        <span className="exec-related-meta">
                          {" "}
                          · {goalStatusText(child)} · {child.progress}% · {executorDisplayLabel(child.executorId)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </DetailBlock>
            )}

            <DetailBlock label="原始描述">
              <DetailText text={goal.userDraft} />
            </DetailBlock>

            <DetailBlock label="验收标准">
              <DetailText text={goal.acceptance} max={480} />
            </DetailBlock>

            <DetailBlock label="执行说明">
              <pre className="exec-goal-detail-pre">{truncate(goal.executionPrompt, 480)}</pre>
            </DetailBlock>

            {goal.constraints.length > 0 && (
              <DetailBlock label="约束">
                <ul className="exec-constraint-list">
                  {goal.constraints.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </DetailBlock>
            )}

            {goal.resultSummary && (
              <DetailBlock label="执行结果">
                <pre className="exec-goal-detail-pre highlight">{truncate(goal.resultSummary, 480)}</pre>
              </DetailBlock>
            )}

            {goal.reworkReason && (
              <DetailBlock label="返工说明" warn>
                <DetailText text={goal.reworkReason} max={480} />
              </DetailBlock>
            )}
          </details>

          {showRework && canRework && (
            <div className="exec-goal-detail-section">
              <textarea
                className="mech-textarea exec-rework-input"
                rows={2}
                placeholder="想让它怎么改？（可选）"
                value={reworkDraft}
                onChange={(e) => setReworkDraft(e.target.value)}
              />
            </div>
          )}

          <div className="exec-goal-detail-actions">
            {canApprove && (
              <button type="button" className="btn primary compact" disabled={busy} onClick={onApprove}>
                确认完成
              </button>
            )}
            {canRework && (
              <button
                type="button"
                className="btn compact"
                disabled={busy}
                onClick={() => {
                  if (!showRework) {
                    setShowRework(true);
                    return;
                  }
                  onRework(reworkDraft.trim() || undefined);
                  setReworkDraft("");
                  setShowRework(false);
                }}
              >
                {showRework ? "提交修改" : "还要修改"}
              </button>
            )}
            {canStart && (
              <button type="button" className="btn primary compact" disabled={busy} onClick={onStart}>
                开始推进
              </button>
            )}
            {canCancel && (
              <button
                type="button"
                className="btn danger compact"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`确定取消任务「${goal.title}」？`)) onCancel();
                }}
              >
                取消任务
              </button>
            )}
            <button type="button" className="btn linkish compact" disabled={busy} onClick={onOpenDetail}>
              完整详情 →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
