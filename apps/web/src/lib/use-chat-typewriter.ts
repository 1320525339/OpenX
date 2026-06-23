import { useEffect, useRef, useState } from "react";
import { advanceTypewriterVisible } from "./chat-typewriter";

export type UseChatTypewriterOptions = {
  /** 每秒字符数（中英文混合近似） */
  charsPerSecond?: number;
  /** 目标文本领先较多时自动加速追赶（SSE 流式追赶用） */
  backlogBoost?: boolean;
};

export function useChatTypewriter(
  targetText: string,
  active: boolean,
  options: UseChatTypewriterOptions = {},
) {
  const charsPerSecond = options.charsPerSecond ?? 32;
  const backlogBoost = options.backlogBoost ?? false;

  const [visibleCount, setVisibleCount] = useState(() => (active ? 0 : targetText.length));
  const visibleRef = useRef(active ? 0 : targetText.length);
  const pauseRef = useRef(0);
  const lastTsRef = useRef(0);
  const targetRef = useRef(targetText);
  const activeRef = useRef(active);
  const prevActiveRef = useRef(false);

  targetRef.current = targetText;
  activeRef.current = active;

  useEffect(() => {
    const wasActive = prevActiveRef.current;
    prevActiveRef.current = active;

    if (!active) {
      visibleRef.current = targetText.length;
      pauseRef.current = 0;
      setVisibleCount(targetText.length);
      return;
    }

    if (!wasActive || targetText.length < visibleRef.current) {
      visibleRef.current = 0;
      pauseRef.current = 0;
      lastTsRef.current = 0;
      setVisibleCount(0);
    }
  }, [active, targetText]);

  useEffect(() => {
    if (!active) return;

    let raf = 0;

    const tick = (ts: number) => {
      if (!activeRef.current) return;

      const target = targetRef.current;
      const dt = lastTsRef.current ? ts - lastTsRef.current : 16;
      lastTsRef.current = ts;

      const { next, remainingPauseMs } = advanceTypewriterVisible(
        visibleRef.current,
        target,
        dt,
        {
          charsPerSecond,
          backlogBoost,
          pauseMs: pauseRef.current,
        },
      );

      pauseRef.current = remainingPauseMs;
      if (next !== visibleRef.current) {
        visibleRef.current = next;
        setVisibleCount(next);
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, charsPerSecond, backlogBoost]);

  const displayText = active ? targetText.slice(0, visibleCount) : targetText;
  const isTyping = active && visibleCount < targetText.length;

  return { displayText, isTyping, visibleCount, targetLength: targetText.length };
}
