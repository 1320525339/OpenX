import type { CoachDispatchPermissionPayload } from "@openx/shared";
import { DISPATCH_PERMISSION_LABELS } from "@openx/shared";

type Props = {
  permission: CoachDispatchPermissionPayload;
  loading?: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
};

/** 工头派单权限变更确认卡 */
export function ChatDispatchPermissionCard({
  permission,
  loading,
  onConfirm,
  onDismiss,
}: Props) {
  const settled = permission.status !== "pending";
  const meta = DISPATCH_PERMISSION_LABELS[permission.requestedMode];

  return (
    <article className="chat-workorder chat-dispatch-permission" aria-label="派单权限申请">
      <header className="chat-workorder-head">
        <span className="chat-workorder-label">派单权限</span>
        <span className="chat-operator-method">{meta.label}</span>
      </header>

      <p className="chat-workorder-hint">{meta.description}</p>
      {permission.reason ? (
        <p className="chat-operator-reason">{permission.reason}</p>
      ) : null}

      {settled ? (
        <p className="chat-refined-hint">
          {permission.status === "confirmed" ? "已确认并应用" : "已保持当前权限"}
        </p>
      ) : (
        <footer className="chat-workorder-dock">
          <button
            type="button"
            className="btn secondary"
            disabled={loading}
            onClick={onDismiss}
          >
            取消
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={loading}
            onClick={onConfirm}
          >
            确认切换
          </button>
        </footer>
      )}
    </article>
  );
}
