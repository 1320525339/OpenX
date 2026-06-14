import type { OperatorActionMeta } from "@openx/shared";

type Props = {
  action: OperatorActionMeta;
  loading?: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
};

/** 工头 admin 敏感 API 写操作确认卡 */
export function ChatOperatorActionCard({
  action,
  loading,
  onConfirm,
  onDismiss,
}: Props) {
  const settled = action.status !== "pending";

  return (
    <article className="chat-workorder chat-operator-action" aria-label="待确认操作">
      <header className="chat-workorder-head">
        <span className="chat-workorder-label">工头操作</span>
        <span className="chat-operator-method">
          {action.method} {action.path}
        </span>
      </header>

      <p className="chat-workorder-hint">{action.summary}</p>
      {action.reason ? (
        <p className="chat-operator-reason">{action.reason}</p>
      ) : null}

      {settled ? (
        <p className="chat-refined-hint">
          {action.status === "confirmed" ? "已确认并执行" : "已取消"}
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
            确认执行
          </button>
        </footer>
      )}
    </article>
  );
}
