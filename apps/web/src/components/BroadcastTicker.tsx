import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import type {
  DynamicIslandPayload,
  IslandAction,
  IslandActionButton,
  IslandPayloadKind,
} from "@openx/shared";
import { islandDedupeKey } from "@openx/shared";
import { DeliveryChips } from "./DeliveryChips";
import { ReviewTimelineCompact } from "./ReviewTimelineCompact";

type Props = {
  payload: DynamicIslandPayload | null;
  displayToken?: number | null;
  /** 关闭当前展示；传入 displayToken 供队列层校验所有权 */
  onDismiss: (token?: number) => void;
  /**
   * 动作处理器。返回 true 表示队列层已完成展示，Ticker 不再二次 dismiss；
   * 返回 false/void 时由 Ticker 走离开动画并 onDismiss。
   */
  onAction: (
    action: IslandAction,
    feedback?: string,
  ) => boolean | void | Promise<boolean | void>;
};

const DEFAULT_AUTO_DISMISS_MS = 6000;

function islandBtnClass(variant: IslandActionButton["variant"] = "default"): string {
  if (variant === "primary") return "dynamic-island-btn primary";
  if (variant === "danger") return "dynamic-island-btn danger";
  if (variant === "ghost") return "dynamic-island-btn ghost";
  return "dynamic-island-btn";
}

function islandUsesReviewTimeline(kind: IslandPayloadKind): boolean {
  return (
    kind === "goal.awaiting_review" ||
    kind === "goal.review_limit" ||
    kind === "goal.review_unavailable" ||
    kind === "goal.review_fail"
  );
}

export function BroadcastTicker({ payload, displayToken, onDismiss, onAction }: Props) {
  const [phase, setPhase] = useState<"hidden" | "entering" | "visible" | "leaving">("hidden");
  const [visiblePayload, setVisiblePayload] = useState<DynamicIslandPayload | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const dismissTimer = useRef<number | null>(null);
  const leaveTimer = useRef<number | null>(null);
  const hoveredRef = useRef(false);
  const expandedRef = useRef(false);
  const displayKeyRef = useRef<string | null>(null);
  const displayTokenRef = useRef<number | null>(null);

  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  useEffect(() => {
    if (displayToken != null) {
      displayTokenRef.current = displayToken;
    }
  }, [displayToken]);

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
    const token = displayTokenRef.current ?? undefined;
    setPhase("leaving");
    leaveTimer.current = window.setTimeout(() => {
      setPhase("hidden");
      setExpanded(false);
      expandedRef.current = false;
      setFeedback("");
      onDismiss(token);
    }, 320);
  }, [clearTimers, onDismiss]);

  const scheduleDismiss = useCallback(
    (ms: number) => {
      if (ms <= 0) return;
      if (expandedRef.current) return;
      if (dismissTimer.current !== null) {
        window.clearTimeout(dismissTimer.current);
      }
      dismissTimer.current = window.setTimeout(() => {
        if (!hoveredRef.current && !expandedRef.current) dismiss();
      }, ms);
    },
    [dismiss],
  );

  useEffect(() => {
    if (!payload) {
      displayKeyRef.current = null;
      setVisiblePayload(null);
      clearTimers();
      return () => {
        clearTimers();
      };
    }

    const nextKey = islandDedupeKey(payload) ?? payload.id;
    const sameCard = displayKeyRef.current === nextKey;

    setVisiblePayload(payload);
    if (sameCard) return;

    displayKeyRef.current = nextKey;
    clearTimers();
    const nextExpanded = Boolean(payload.expanded);
    setExpanded(nextExpanded);
    expandedRef.current = nextExpanded;
    setFeedback("");
    setPhase("entering");
    const enterTimer = window.setTimeout(() => setPhase("visible"), 20);
    scheduleDismiss(payload.autoDismissMs ?? DEFAULT_AUTO_DISMISS_MS);
    return () => {
      window.clearTimeout(enterTimer);
      clearTimers();
    };
  }, [payload, clearTimers, scheduleDismiss]);

  const toggleExpand = (e?: MouseEvent) => {
    e?.stopPropagation();
    setExpanded((value) => {
      const next = !value;
      expandedRef.current = next;
      if (next) {
        clearTimers();
      } else if (visiblePayload) {
        scheduleDismiss(visiblePayload.autoDismissMs ?? DEFAULT_AUTO_DISMISS_MS);
      }
      return next;
    });
  };

  const runAction = async (action: IslandAction, useFeedback = false) => {
    if (busy) return;
    setBusy(true);
    // 动作执行期间暂停自动关闭，避免与异步 handler 竞态
    clearTimers();
    try {
      const fb = useFeedback ? feedback.trim() : undefined;
      const result =
        action.type === "rework" && fb
          ? await onAction({ ...action, reason: fb }, fb)
          : await onAction(action, fb);
      // 仅当队列层未完成展示时，才由 UI 走 dismiss → onDismiss
      if (!result) dismiss();
    } finally {
      setBusy(false);
    }
  };

  if (!visiblePayload || phase === "hidden") return null;

  const severity = visiblePayload.severity ?? "info";
  const hasExpandable =
    Boolean(visiblePayload.allowFeedback) ||
    Boolean(visiblePayload.meta?.resultPreview) ||
    Boolean(visiblePayload.meta?.deliverables?.length) ||
    Boolean(visiblePayload.meta?.reworkInstruction) ||
    Boolean(visiblePayload.meta?.reviewReason) ||
    Boolean(visiblePayload.actions?.length) ||
    Boolean(visiblePayload.message?.trim());

  return createPortal(
    <div className="dynamic-island-portal app-minimal" role="presentation">
      <div
        className={`dynamic-island dynamic-island-toast ${severity} ${phase}${expanded ? " expanded" : " collapsed"}${hasExpandable ? " can-expand" : ""}`}
        role="status"
        aria-live="polite"
        onMouseEnter={() => {
          hoveredRef.current = true;
          clearTimers();
        }}
        onMouseLeave={() => {
          hoveredRef.current = false;
          scheduleDismiss(visiblePayload.autoDismissMs ?? DEFAULT_AUTO_DISMISS_MS);
        }}
      >
        <div
          className="dynamic-island-head"
          onClick={hasExpandable && !expanded ? () => toggleExpand() : undefined}
        >
          <button
            type="button"
            className="dynamic-island-compact"
            aria-label={visiblePayload.message || visiblePayload.title}
            aria-expanded={hasExpandable ? expanded : undefined}
            onClick={
              hasExpandable
                ? toggleExpand
                : () => void runAction({ type: "dismiss" })
            }
          >
            <span className={`dynamic-island-dot ${severity}`} aria-hidden />
            <span className="dynamic-island-body">
              <span className="dynamic-island-title">{visiblePayload.title}</span>
              {expanded ? (
                <span className="dynamic-island-text">{visiblePayload.message}</span>
              ) : (
                <span className="dynamic-island-text dynamic-island-text-collapsed">
                  {visiblePayload.message}
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
            {visiblePayload.meta?.reworkInstruction ? (
              <div className="dynamic-island-section">
                <strong>修改清单</strong>
                <pre className="dynamic-island-preview">{visiblePayload.meta.reworkInstruction}</pre>
              </div>
            ) : null}
            {visiblePayload.meta?.reviewReason ? (
              <div className="dynamic-island-section">
                <strong>审查说明</strong>
                <p className="dynamic-island-text-block">{visiblePayload.meta.reviewReason}</p>
              </div>
            ) : null}
            {visiblePayload.meta?.deliverables && visiblePayload.meta.deliverables.length > 0 && (
              <DeliveryChips items={visiblePayload.meta.deliverables} compact />
            )}
            {visiblePayload.meta?.resultPreview ? (
              <div className="dynamic-island-section">
                <strong>执行摘要</strong>
                <pre className="dynamic-island-preview">{visiblePayload.meta.resultPreview}</pre>
              </div>
            ) : null}
            {visiblePayload.goalId && islandUsesReviewTimeline(visiblePayload.kind) ? (
              <ReviewTimelineCompact
                goalId={visiblePayload.goalId}
                compact
                showFeedback={visiblePayload.allowFeedback}
                feedback={feedback}
                onFeedbackChange={setFeedback}
                onApprove={
                  visiblePayload.actions?.some((a) => a.action.type === "approve")
                    ? () => void runAction({ type: "approve", goalId: visiblePayload.goalId! })
                    : undefined
                }
                onRework={
                  visiblePayload.actions?.some((a) => a.action.type === "rework")
                    ? (reason) =>
                        void runAction(
                          { type: "rework", goalId: visiblePayload.goalId!, reason },
                          true,
                        )
                    : undefined
                }
                onTriggerReview={
                  visiblePayload.actions?.some((a) => a.action.type === "trigger_review")
                    ? () =>
                        void runAction({
                          type: "trigger_review",
                          goalId: visiblePayload.goalId!,
                        })
                    : undefined
                }
              />
            ) : !visiblePayload.meta?.resultPreview && visiblePayload.message ? (
              <p className="dynamic-island-text-block">{visiblePayload.message}</p>
            ) : null}
            {visiblePayload.allowFeedback && !islandUsesReviewTimeline(visiblePayload.kind) ? (
              <textarea
                className="dynamic-island-feedback"
                rows={2}
                value={feedback}
                placeholder={visiblePayload.feedbackPlaceholder ?? "补充反馈…"}
                onChange={(e) => setFeedback(e.target.value)}
              />
            ) : null}
            <div className="dynamic-island-actions">
              {(islandUsesReviewTimeline(visiblePayload.kind)
                ? visiblePayload.actions?.filter(
                    (btn) =>
                      btn.action.type !== "approve" &&
                      btn.action.type !== "rework" &&
                      btn.action.type !== "trigger_review",
                  )
                : visiblePayload.actions
              )?.map((btn: IslandActionButton) => (
                <button
                  key={btn.id}
                  type="button"
                  className={islandBtnClass(btn.variant)}
                  disabled={busy}
                  onClick={() => {
                    const needsFeedback =
                      btn.action.type === "rework" && visiblePayload.allowFeedback;
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
                onClick={() => toggleExpand()}
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
