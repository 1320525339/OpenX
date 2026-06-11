import { useState } from "react";
import type { Goal } from "@openx/shared";
import { truncate } from "../lib/goal-detail";

export type GoalTaskActionHandlers = {
  onStart?: (id: string) => Promise<void>;
  onApprove?: (id: string) => Promise<void>;
  onRework?: (id: string, reason?: string) => Promise<void>;
  onOpenDetail?: () => void;
};

type Props = {
  goal: Goal;
  handlers?: GoalTaskActionHandlers;
  /** 卡片收起时更紧凑 */
  compact?: boolean;
};

type Phase = "idle" | "approve" | "rework";

export function goalHasTaskActions(
  goal: Goal,
  handlers?: GoalTaskActionHandlers,
): boolean {
  if (!handlers) return false;
  if (goal.status === "draft" || goal.status === "failed") return Boolean(handlers.onStart);
  if (goal.status === "awaiting_review") {
    return Boolean(handlers.onApprove || handlers.onRework || handlers.onOpenDetail);
  }
  if (goal.status === "running" || goal.status === "done") {
    return Boolean(handlers.onOpenDetail);
  }
  return false;
}

export function GoalTaskActions({ goal, handlers, compact }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [reworkReason, setReworkReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (!handlers) return null;

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      setPhase("idle");
      setReworkReason("");
    } finally {
      setBusy(false);
    }
  };

  const detailBtn =
    handlers.onOpenDetail && goal.status !== "draft" && goal.status !== "failed" ? (
      <button
        type="button"
        className="btn btn-ghost compact"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          handlers.onOpenDetail?.();
        }}
      >
        详情
      </button>
    ) : null;

  if (goal.status === "draft" || goal.status === "failed") {
    if (!handlers.onStart) return detailBtn;
    return (
      <div className={`goal-task-actions${compact ? " compact" : ""}`}>
        <button
          type="button"
          className="btn primary compact"
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            void run(() => handlers.onStart!(goal.id));
          }}
        >
          {goal.status === "failed" ? "重试" : "开始推进"}
        </button>
        {detailBtn}
      </div>
    );
  }

  if (goal.status === "awaiting_review") {
    if (phase === "approve") {
      return (
        <div
          className={`goal-task-actions${compact ? " compact" : ""}`}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="goal-task-confirm-hint">
            {truncate(goal.acceptance || "按验收标准确认", 56)}
          </p>
          <div className="goal-task-actions-row">
            <button
              type="button"
              className="btn primary compact"
              disabled={busy}
              onClick={() => void run(() => handlers.onApprove!(goal.id))}
            >
              确定
            </button>
            <button
              type="button"
              className="btn compact"
              disabled={busy}
              onClick={() => setPhase("idle")}
            >
              取消
            </button>
          </div>
        </div>
      );
    }

    if (phase === "rework") {
      return (
        <div
          className={`goal-task-actions${compact ? " compact" : ""}`}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            className="goal-task-rework-input"
            value={reworkReason}
            placeholder="返工说明（可选）"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setReworkReason(e.target.value)}
          />
          <div className="goal-task-actions-row">
            <button
              type="button"
              className="btn warn compact"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  handlers.onRework!(goal.id, reworkReason.trim() || undefined),
                )
              }
            >
              提交返工
            </button>
            <button
              type="button"
              className="btn compact"
              disabled={busy}
              onClick={() => {
                setPhase("idle");
                setReworkReason("");
              }}
            >
              取消
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className={`goal-task-actions${compact ? " compact" : ""}`}>
        <div className="goal-task-actions-row">
          {handlers.onApprove && (
            <button
              type="button"
              className="btn primary compact"
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                setPhase("approve");
              }}
            >
              确认完成
            </button>
          )}
          {handlers.onRework && (
            <button
              type="button"
              className="btn warn compact"
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                setPhase("rework");
              }}
            >
              还要修改
            </button>
          )}
          {detailBtn}
        </div>
      </div>
    );
  }

  if (goal.status === "running") {
    return detailBtn ? (
      <div className={`goal-task-actions${compact ? " compact" : ""}`}>{detailBtn}</div>
    ) : null;
  }

  if (goal.status === "done") {
    return detailBtn ? (
      <div className={`goal-task-actions${compact ? " compact" : ""}`}>{detailBtn}</div>
    ) : null;
  }

  return null;
}
