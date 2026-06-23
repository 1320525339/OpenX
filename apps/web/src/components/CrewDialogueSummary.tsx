import { useEffect, useState } from "react";
import type { CrewExchangeRecord } from "@openx/shared";
import { api } from "../api";

type Props = {
  goalId: string;
  crewStatus?: string;
  /** 嵌入任务单卡片内，使用对话流样式 */
  embedded?: boolean;
  className?: string;
};

const DIRECTION_LABEL: Record<string, string> = {
  crew_to_foreman: "施工队 → 工头",
  foreman_to_crew: "工头 → 施工队",
  foreman_escalation: "工头 → 开发商",
  foreman_review: "工头验收",
};

function exchangeLabel(direction: CrewExchangeRecord["direction"]): string {
  return DIRECTION_LABEL[direction] ?? direction;
}

export function CrewDialogueSummary({
  goalId,
  crewStatus,
  embedded = false,
  className = "",
}: Props) {
  const [messages, setMessages] = useState<CrewExchangeRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    void api
      .getGoalCrewMessages(goalId)
      .then((res) => setMessages(res.messages))
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 8_000);
    return () => clearInterval(timer);
  }, [goalId, crewStatus]);

  if (messages.length === 0 && !error && crewStatus !== "awaiting_user") {
    return null;
  }

  const rootClass = [
    "crew-dialogue-summary",
    embedded ? "crew-dialogue-summary-embedded" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (embedded) {
    return (
      <div className={rootClass}>
        {crewStatus === "awaiting_user" ? (
          <p className="crew-dialogue-embedded-hint">
            工头等待你的决策。请直接在输入框回复，工头会转告施工队继续执行。
          </p>
        ) : null}
        {error ? <p className="crew-dialogue-embedded-hint warn">{error}</p> : null}
        {messages.length === 0 ? (
          <p className="crew-dialogue-embedded-hint">工头与施工队协作消息将显示在此处</p>
        ) : (
          <div className="chat-task-crew-thread">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`chat-crew-exchange chat-crew-${m.direction} chat-task-crew-item`}
              >
                <div className="chat-crew-exchange-card">
                  <div className="chat-crew-exchange-head">
                    <span className="chat-crew-exchange-label">
                      {exchangeLabel(m.direction)}
                    </span>
                    <time className="chat-turn-time" dateTime={m.createdAt}>
                      {new Date(m.createdAt).toLocaleTimeString(undefined, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                  <p className="chat-crew-exchange-body">{m.summary}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const escalations = messages.filter((m) => m.direction === "foreman_escalation");
  const dialogue = messages.filter((m) => m.direction !== "foreman_escalation");

  return (
    <div className={rootClass}>
      {crewStatus === "awaiting_user" ? (
        <p className="settings-hint settings-hint-warn crew-dialogue-escalation">
          工头等待你的决策。请直接在输入框回复，工头会转告施工队继续执行。
        </p>
      ) : null}
      {error ? <p className="settings-hint settings-hint-warn">{error}</p> : null}
      {escalations.length > 0 ? (
        <ul className="crew-dialogue-list crew-dialogue-escalations">
          {escalations.map((m) => (
            <li key={m.id} className="crew-dialogue-item escalation">
              <span className="crew-dialogue-who">{exchangeLabel(m.direction)}</span>
              <span className="crew-dialogue-text">{m.summary}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {dialogue.length > 0 ? (
        <>
          <p className="exec-goal-detail-label">工头 ↔ 施工队</p>
          <ul className="crew-dialogue-list">
            {dialogue.slice(-8).map((m) => (
              <li key={m.id} className={`crew-dialogue-item ${m.direction}`}>
                <span className="crew-dialogue-who">
                  {exchangeLabel(m.direction)}
                </span>
                <span className="crew-dialogue-text">{m.summary}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="settings-hint settings-hint-tight">暂无工头与施工队对话记录</p>
      )}
    </div>
  );
}
