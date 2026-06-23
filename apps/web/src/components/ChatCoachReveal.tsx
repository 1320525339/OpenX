import { useEffect, useRef } from "react";
import { renderCoachMessageText } from "../lib/chat-message-format";
import { useChatTypewriter } from "../lib/use-chat-typewriter";

type Props = {
  text: string;
  onFinished?: () => void;
  onTypingChange?: (typing: boolean) => void;
};

/** 工头回复打字机展示（挂载时即开始，不经过 active=false 全量闪现） */
export function ChatCoachReveal({ text, onFinished, onTypingChange }: Props) {
  const { displayText, isTyping } = useChatTypewriter(text, true, {
    charsPerSecond: 58,
    backlogBoost: false,
  });
  const finishedRef = useRef(false);

  useEffect(() => {
    onTypingChange?.(isTyping);
  }, [isTyping, onTypingChange]);

  useEffect(() => {
    if (isTyping) return;
    if (finishedRef.current) return;
    finishedRef.current = true;
    onFinished?.();
  }, [isTyping, onFinished]);

  return (
    <>
      {renderCoachMessageText(displayText, { streaming: isTyping })}
      {isTyping ? <span className="chat-stream-cursor" aria-hidden="true" /> : null}
    </>
  );
}
