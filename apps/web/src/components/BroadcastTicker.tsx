import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import type {
  DynamicIslandPayload,
  IslandAction,
  IslandActionButton,
} from "@openx/shared";
import { DeliveryChips } from "./DeliveryChips";
import { ReviewTimelineCompact } from "./ReviewTimelineCompact";

type Props = {
  payload: DynamicIslandPayload | null;
  onDismiss: () => void;
  onAction: (action: IslandAction, feedback?: string) => void | Promise<void>;
};

const DEFAULT_AUTO_DISMISS_MS = 6000;

function islandBtnClass(variant: IslandActionButton["variant"] = "default"): string {
  if (variant === "primary") return "dynamic-island-btn primary";
  if (variant === "danger") return "dynamic-island-btn danger";
  if (variant === "ghost") return "dynamic-island-btn ghost";
  return "dynamic-island-btn";
}

export function BroadcastTicker({ payload, onDismiss, onAction }: Props) {
  const [phase, setPhase] = useState<"hidden" | "entering" | "visible" | "leaving">("hidden");
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const dismissTimer = useRef<number | null>(null);
  const leaveTimer = useRef<number | null>(null);
  const hovered = useRef(false);

  const clearTimers = useCallback(() => {
    if (dismissTimer.current !== null) {
      window.clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
    if (leaveTimer.current !== null) {
      window.clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearTimers();
    setPhase("leaving");
    leaveTimer.current = window.setTimeout(() => {
      setPhase("hidden");
      setExpanded(false);
      setFeedback("");
      onDismiss();
    }, 320);
  }, [clearTimers, onDismiss]);

  const scheduleDismiss = useCallback(
    (ms: number) => {
      if (ms <= 0) return;
      if (dismissTimer.current !== null) {
        window.clearTimeout(dismissTimer.current);
      }
      dismissTimer.current = window.setTimeout(() => {
        if (!hovered.current && !expanded) dismiss();
      }, ms);
    },
    [dismiss, expanded],
  );

  useEffect(() => {
    if (!payload) return;
    clearTimers();
    setExpanded(Boolean(payload.expanded));
    setFeedback("");
    setPhase("entering");
    const enterTimer = window.setTimeout(() => setPhase("visible"), 20);
    scheduleDismiss(payload.autoDismissMs ?? DEFAULT_AUTO_DISMISS_MS);
    return () => {
      window.clearTimeout(enterTimer);
      clearTimers();
    };
  }, [payload?.id, payload, clearTimers, scheduleDismiss]);

  const toggleExpand = (e: MouseEvent) => {
    e.stopPropagation();
    setExpanded((v) => !v);
    if (payload) {
      clearTimers();
      scheduleDismiss(payload.autoDismissMs ?? DEFAULT_AUTO_DISMISS_MS);
    }
  };

  const runAction = async (action: IslandAction, useFeedback = false) => {
    if (busy) return;
    setBusy(true);
    try {
      const fb = useFeedback ? feedback.trim() : undefined;
      if (action.type === "rework" && fb) {
        await onAction({ ...action, reason: fb }, fb);
      } else {
        await onAction(action, fb);
      }
      if (action.type !== "dismiss") dismiss();
    } finally {
      setBusy(false);
    }
  };

  if (!payload || phase === "hidden") return null;

  const severity = payload.severity ?? "info";
  const hasExpandable =
    Boolean(payload.allowFeedback) ||
    Boolean(payload.meta?.resultPreview) ||
    Boolean(payload.meta?.deliverables?.length) ||
    Boolean(payload.meta?.reworkInstruction) ||
    Boolean(payload.goalId);

  return createPortal(
    <div className="dynamic-island-portal app-minimal" role="presentation">
      <div
        className={`dynamic-island dynamic-island-toast ${severity} ${phase}${expanded ? " expanded" : " collapsed"}${hasExpandable ? " can-expand" : ""}`}
        role="status"
        aria-live="polite"
        onMouseEnter={() => {
          hovered.current = true;
          clearTimers();
        }}
        onMouseLeave={() => {
          hovered.current = false;
          scheduleDismiss(payload.autoDismissMs ?? DEFAULT_AUTO_DISMISS_MS);
        }}
      >
        <div className="dynamic-island-head">
          <button
            type="button"
            className="dynamic-island-compact"
            aria-label={payload.message}
            onClick={hasExpandable ? toggleExpand : () => void runAction({ type: "dismiss" })}
          >
            <span className={`dynamic-island-dot ${severity}`} aria-hidden />
            <span className="dynamic-island-body">
              <span className="dynamic-island-title">{payload.title}</span>
              {expanded ? (
                <span className="dynamic-island-text">{payload.message}</span>
              ) : (
                <span className="dynamic-island-text dynamic-island-text-collapsed">
                  {payload.message}
                </span>
              )}
            </span>
          </button>
          <button
            type="button"
            className="dynamic-island-dismiss"
            aria-label="关闭"
            onClick={(e) => {
              e.stopPropagation();
              dismiss();
            }}
          >
            ×
          </button>
        </div>

        {expanded ? (
          <div className="dynamic-island-expanded">
            {payload.meta?.reworkInstruction ? (
              <div className="dynamic-island-section">
                <strong>修改清单</strong>
                <pre className="dynamic-island-preview">{payload.meta.reworkInstruction}</pre>
              </div>
            ) : null}
            {payload.meta?.reviewReason ? (
              <div className="dynamic-island-section">
                <strong>审查说明</strong>
                <p className="dynamic-island-text-block">{payload.meta.reviewReason}</p>
              </div>
            ) : null}
            {payload.meta?.deliverables && payload.meta.deliverables.length > 0 && (
              <DeliveryChips items={payload.meta.deliverables} compact />
            )}
            {payload.meta?.resultPreview && (
              <pre className="dynamic-island-preview">{payload.meta.resultPreview}</pre>
            )}
            {payload.goalId && payload.kind.startsWith("goal.") ? (
              <ReviewTimelineCompact
                goalId={payload.goalId}
                compact
                showFeedback={payload.allowFeedback}
                feedback={feedback}
                onFeedbackChange={setFeedback}
                onApprove={
                  payload.actions?.some((a) => a.action.type === "approve")
                    ? () => void runAction({ type: "approve", goalId: payload.goalId! })
                    : undefined
                }
                onRework={
                  payload.actions?.some((a) => a.action.type === "rework")
                    ? (reason) =>
                        void runAction(
                          { type: "rework", goalId: payload.goalId!, reason },
                          true,
                        )
                    : undefined
                }
                onTriggerReview={
                  payload.actions?.some((a) => a.action.type === "trigger_review")
                    ? () =>
                        void runAction({
                          type: "trigger_review",
                          goalId: payload.goalId!,
                        })
                    : undefined
                }
              />
            ) : payload.allowFeedback ? (
              <textarea
                className="dynamic-island-feedback"
                rows={2}
                value={feedback}
                placeholder={payload.feedbackPlaceholder ?? "补充反馈…"}
                onChange={(e) => setFeedback(e.target.value)}
              />
            ) : null}
            <div className="dynamic-island-actions">
              {payload.actions?.map((btn: IslandActionButton) => (
                <button
                  key={btn.id}
                  type="button"
                  className={islandBtnClass(btn.variant)}
                  disabled={busy}
                  onClick={() => {
                    const needsFeedback =
                      btn.action.type === "rework" && payload.allowFeedback;
                    void runAction(btn.action, needsFeedback);
                  }}
                >
                  {btn.label}
                </button>
              ))}
              <button
                type="button"
                className="dynamic-island-btn ghost"
                disabled={busy}
                onClick={() => setExpanded(false)}
              >
                收起
              </button>
              <button
                type="button"
                className="dynamic-island-btn ghost"
                disabled={busy}
                onClick={() => dismiss()}
              >
                关闭
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
