import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CoachMessageRecord } from "@openx/shared";
import { renderCoachMessageText } from "../lib/chat-message-format";
import { useChatTypewriter } from "../lib/use-chat-typewriter";

type CoachStreamLike = {
  text: string;
} | null;

type Props = {
  activeStream: CoachStreamLike;
  threadRecords: CoachMessageRecord[];
  loading: boolean;
  onSurfaceChange?: (surface: CoachStreamSurface) => void;
};

export type CoachStreamSurface = {
  showing: boolean;
  liveText: string;
  isTyping: boolean;
};

/** 工头流式回复：打字机逐字输出，结束后短暂停留再交给线程消息 */
export function ChatCoachStreamingBubble({
  activeStream,
  threadRecords,
  loading,
  onSurfaceChange,
}: Props) {
  const lastStreamTextRef = useRef("");
  const [lingerText, setLingerText] = useState<string | null>(null);

  useEffect(() => {
    if (activeStream?.text) {
      lastStreamTextRef.current = activeStream.text;
      setLingerText(activeStream.text);
    }
  }, [activeStream?.text]);

  const revealText = activeStream?.text ?? lingerText ?? "";
  const revealActive = Boolean(activeStream || lingerText);

  const { displayText, isTyping } = useChatTypewriter(revealText, revealActive, {
    charsPerSecond: 30,
    backlogBoost: true,
  });

  const threadHasFullCoach = useMemo(() => {
    if (!lingerText) return false;
    for (let i = threadRecords.length - 1; i >= 0; i -= 1) {
      const row = threadRecords[i];
      if (row?.kind === "text" && row.role === "coach") {
        return row.text === lingerText;
      }
    }
    return false;
  }, [lingerText, threadRecords]);

  const clearLinger = useCallback(() => {
    setLingerText(null);
    lastStreamTextRef.current = "";
  }, []);

  useEffect(() => {
    if (!lingerText || activeStream) return;
    if (isTyping) return;
    if (threadHasFullCoach || !loading) {
      const id = window.setTimeout(clearLinger, 60);
      return () => window.clearTimeout(id);
    }
  }, [activeStream, clearLinger, isTyping, lingerText, loading, threadHasFullCoach]);

  const showBubble = useMemo(() => {
    if (!revealText) return false;
    if (activeStream) return true;
    if (isTyping) return true;
    if (lingerText && !threadHasFullCoach) return true;
    return false;
  }, [activeStream, isTyping, lingerText, revealText, threadHasFullCoach]);

  useEffect(() => {
    onSurfaceChange?.({
      showing: showBubble,
      liveText: revealText,
      isTyping,
    });
  }, [isTyping, onSurfaceChange, revealText, showBubble]);

  if (!showBubble) return null;

  return (
    <div className="chat-turn chat-turn-coach">
      <div className="chat-turn-meta">
        <span className="chat-turn-role">工头</span>
        <span className="chat-stream-status">{isTyping ? "输出中" : "工头"}</span>
      </div>
      <div className={`chat-bubble coach streaming${isTyping ? " typewriting" : ""}`}>
        {renderCoachMessageText(displayText, { streaming: isTyping })}
        {isTyping ? <span className="chat-stream-cursor" aria-hidden="true" /> : null}
      </div>
    </div>
  );
}
