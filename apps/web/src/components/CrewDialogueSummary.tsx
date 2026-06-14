import { useEffect, useState } from "react";
import type { CrewExchangeRecord } from "@openx/shared";
import { api } from "../api";

type Props = {
  goalId: string;
  crewStatus?: string;
};

const DIRECTION_LABEL: Record<string, string> = {
  crew_to_foreman: "施工队",
  foreman_to_crew: "工头",
  foreman_escalation: "需你审核",
  foreman_review: "工头验收",
};

export function CrewDialogueSummary({ goalId, crewStatus }: Props) {
  const [messages, setMessages] = useState<CrewExchangeRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .getGoalCrewMessages(goalId)
      .then((res) => {
        if (!cancelled) setMessages(res.messages);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [goalId]);

  const escalations = messages.filter((m) => m.direction === "foreman_escalation");
  const dialogue = messages.filter((m) => m.direction !== "foreman_escalation");

  return (
    <div className="crew-dialogue-summary">
      {crewStatus === "awaiting_user" ? (
        <p className="settings-hint settings-hint-warn crew-dialogue-escalation">
          工头等待你的决策；下方「需你审核」条目请处理。
        </p>
      ) : null}
      {error ? <p className="settings-hint settings-hint-warn">{error}</p> : null}
      {escalations.length > 0 ? (
        <ul className="crew-dialogue-list crew-dialogue-escalations">
          {escalations.map((m) => (
            <li key={m.id} className="crew-dialogue-item escalation">
              <span className="crew-dialogue-who">{DIRECTION_LABEL[m.direction]}</span>
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
                <span className="crew-dialogue-who">{DIRECTION_LABEL[m.direction] ?? m.direction}</span>
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
