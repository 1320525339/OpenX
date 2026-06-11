import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import type { IslandAlert } from "../lib/island-alert";
import { DeliveryChips } from "./DeliveryChips";

type Props = {
  alert: IslandAlert | null;
  onDismiss: () => void;
  onNavigate: (goalId: string) => void;
};

const DEFAULT_AUTO_DISMISS_MS = 6000;

export function BroadcastTicker({ alert, onDismiss, onNavigate }: Props) {
  const [phase, setPhase] = useState<"hidden" | "entering" | "visible" | "leaving">("hidden");
  const [expanded, setExpanded] = useState(false);
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
    if (!alert) return;
    clearTimers();
    setExpanded(Boolean(alert.expanded));
    setPhase("entering");
    const enterTimer = window.setTimeout(() => setPhase("visible"), 20);
    scheduleDismiss(alert.autoDismissMs ?? DEFAULT_AUTO_DISMISS_MS);
    return () => {
      window.clearTimeout(enterTimer);
      clearTimers();
    };
  }, [alert?.id, alert, clearTimers, scheduleDismiss]);

  const toggleExpand = (e: MouseEvent) => {
    e.stopPropagation();
    setExpanded((v) => !v);
    if (alert) {
      clearTimers();
      scheduleDismiss(alert.autoDismissMs ?? DEFAULT_AUTO_DISMISS_MS);
    }
  };

  const handleNavigate = () => {
    if (alert?.goalId) onNavigate(alert.goalId);
    dismiss();
  };

  if (!alert || phase === "hidden") return null;

  const kind = alert.kind ?? "info";
  const hasDelivery =
    (alert.deliverables?.length ?? 0) > 0 || Boolean(alert.resultPreview);
  const canExpand = hasDelivery || alert.status === "awaiting_review";

  return createPortal(
    <div className="dynamic-island-portal" role="presentation">
      <div
        className={`dynamic-island dynamic-island-toast ${kind} ${phase}${expanded ? " expanded" : ""}`}
        role="status"
        aria-live="polite"
        onMouseEnter={() => {
          hovered.current = true;
          clearTimers();
        }}
        onMouseLeave={() => {
          hovered.current = false;
          scheduleDismiss(alert.autoDismissMs ?? DEFAULT_AUTO_DISMISS_MS);
        }}
      >
        <button
          type="button"
          className="dynamic-island-compact"
          aria-label={alert.message}
          onClick={canExpand ? toggleExpand : handleNavigate}
        >
          <span className={`dynamic-island-dot ${kind}`} aria-hidden />
          <span className="dynamic-island-body">
            <span className="dynamic-island-text">{alert.message}</span>
            {canExpand && !expanded && (
              <span className="dynamic-island-hint">
                {alert.status === "awaiting_review"
                  ? "展开查看交付物 · 点击验收"
                  : "展开查看交付物"}
              </span>
            )}
            {alert.goalId && !canExpand && (
              <span className="dynamic-island-hint">点击查看任务</span>
            )}
          </span>
        </button>

        {expanded && (
          <div className="dynamic-island-expanded">
            {alert.deliverables && alert.deliverables.length > 0 && (
              <DeliveryChips items={alert.deliverables} compact />
            )}
            {alert.resultPreview && (
              <pre className="dynamic-island-preview">{alert.resultPreview}</pre>
            )}
            <div className="dynamic-island-actions">
              {alert.goalId && (
                <button
                  type="button"
                  className="btn compact primary"
                  onClick={handleNavigate}
                >
                  {alert.status === "awaiting_review" ? "去验收" : "查看任务"}
                </button>
              )}
              <button
                type="button"
                className="btn compact"
                onClick={() => setExpanded(false)}
              >
                收起
              </button>
            </div>
          </div>
        )}

        <button
          type="button"
          className="dynamic-island-dismiss"
          aria-label="关闭"
          onClick={dismiss}
        >
          ×
        </button>
      </div>
    </div>,
    document.body,
  );
}
