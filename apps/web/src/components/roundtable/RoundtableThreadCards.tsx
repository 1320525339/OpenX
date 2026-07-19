import type { CoachMessageRecord } from "@openx/shared";
import { api } from "../../api";
import { renderChatMessageText } from "../../lib/chat-message-format";

export function PeerRequestCard(props: {
  record: Extract<CoachMessageRecord, { kind: "peer_request" }>;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const req = props.record.peerRequest;
  const pending = req.status === "pending";
  const statusLabel =
    req.status === "pending"
      ? "待确认"
      : req.status === "approved" || req.status === "auto_approved"
        ? "已同意"
        : req.status === "rejected"
          ? "已拒绝"
          : req.status;

  return (
    <div className="chat-turn chat-turn-coach">
      <article
        className={`roundtable-peer-request${pending ? " is-pending" : ""}`}
      >
        <header>
          <strong>
            {req.fromDisplayName} 请求 {req.toDisplayName} 回答
          </strong>
          <span className="roundtable-status">{statusLabel}</span>
        </header>
        <p className="roundtable-peer-question">{req.question}</p>
        {pending ? (
          <footer className="roundtable-bubble-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                void api
                  .rejectPeerRequest(req.id)
                  .then(props.onDone)
                  .catch((err) =>
                    props.onError(
                      err instanceof Error ? err.message : String(err),
                    ),
                  );
              }}
            >
              拒绝
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                void api
                  .approvePeerRequest(req.id)
                  .then(props.onDone)
                  .catch((err) =>
                    props.onError(
                      err instanceof Error ? err.message : String(err),
                    ),
                  );
              }}
            >
              同意
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                void api
                  .approveSessionPeerRequest(req.id)
                  .then(props.onDone)
                  .catch((err) =>
                    props.onError(
                      err instanceof Error ? err.message : String(err),
                    ),
                  );
              }}
            >
              本次会话同意
            </button>
          </footer>
        ) : null}
      </article>
    </div>
  );
}

export function RoundSynthesisCard(props: {
  record: Extract<CoachMessageRecord, { kind: "round_synthesis" }>;
  onContinue: () => void;
  onDiverge: () => void;
  onWorkOrder: () => void;
}) {
  const { synthesis } = props.record;
  return (
    <div className="chat-turn chat-turn-coach">
      <article className="roundtable-synthesis">
        <div className="chat-turn-meta">
          <span className="chat-turn-role">工头总结</span>
        </div>
        <div className="chat-bubble coach">
          <p>
            <strong>共识</strong>
            <br />
            {renderChatMessageText(synthesis.consensus)}
          </p>
          <p>
            <strong>分歧</strong>
            <br />
            {renderChatMessageText(synthesis.disagreements || "（无明显分歧）")}
          </p>
          <p>
            <strong>推荐方案</strong>
            <br />
            {renderChatMessageText(synthesis.recommendation)}
          </p>
          <p>
            <strong>下一步</strong>
            <br />
            {renderChatMessageText(synthesis.nextSteps)}
          </p>
        </div>
        <footer className="roundtable-bubble-actions">
          <button type="button" className="btn" onClick={props.onContinue}>
            继续讨论
          </button>
          <button
            type="button"
            className="btn"
            onClick={props.onDiverge}
          >
            继续发散
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={props.onWorkOrder}
          >
            生成任务单
          </button>
        </footer>
      </article>
    </div>
  );
}
