import { useCallback, useEffect, useRef, useState } from "react";
import type { Goal } from "@openx/shared";
import { api, type ExecutorInfo } from "../api";
import { ExecutorPicker } from "./ExecutorPicker";
import { defaultExecutorChoice } from "../lib/executors";
import { RefinedPreviewCard } from "./RefinedPreviewCard";
import { ChatContextPicker } from "./ChatContextPicker";
import { useSkillCatalog } from "../lib/use-skill-catalog";
import { renderChatMessageText } from "../lib/chat-message-format";
import {
  mapRefinedSubGoals,
  resolveNorthStar,
  type RefinedPreviewState,
} from "../lib/goal-tree";
import type { CoachReplyEvent } from "../lib/app-state";

type ChatMessage = {
  id?: number;
  role: "user" | "coach";
  text: string;
  warn?: boolean;
};

type Props = {
  goals: Goal[];
  selectedGoal: Goal | undefined;
  autoExecute: boolean;
  executors: ExecutorInfo[];
  defaultExecutorId?: string;
  onRefreshed: () => void;
  coachReplyEvent?: CoachReplyEvent | null;
};

const SCROLL_STICK_THRESHOLD_PX = 48;

function isNearBottom(el: HTMLElement) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_STICK_THRESHOLD_PX;
}

export function ChatPanel({
  goals,
  selectedGoal,
  autoExecute,
  executors,
  defaultExecutorId,
  onRefreshed,
  coachReplyEvent,
}: Props) {
  const [draft, setDraft] = useState("");
  const [executorId, setExecutorId] = useState(() =>
    defaultExecutorChoice(executors, defaultExecutorId),
  );
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "coach",
      text: "直接说你想做什么，或问问进展——我会自己判断该怎么帮你。",
    },
  ]);
  const [refinedPreview, setRefinedPreview] = useState<RefinedPreviewState | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [lastUserDraft, setLastUserDraft] = useState("");
  const [chatSkillIds, setChatSkillIds] = useState<string[]>([]);
  const [recommendedExecutor, setRecommendedExecutor] = useState<{
    id: string;
    reason: string;
  } | null>(null);
  const { skills: catalogSkills } = useSkillCatalog();
  const lastCoachReplyTsRef = useRef<string | null>(null);

  const handleContextChange = useCallback(
    ({ skills }: { skills: Record<string, boolean> }) => {
      setChatSkillIds(
        Object.entries(skills)
          .filter(([, on]) => on)
          .map(([id]) => id),
      );
    },
    [],
  );

  useEffect(() => {
    setExecutorId(defaultExecutorChoice(executors, defaultExecutorId));
  }, [executors, defaultExecutorId]);

  const threadRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const skipNextScrollRef = useRef(false);
  const prevMessageCountRef = useRef(messages.length);

  const defaultCoachGreeting =
    "直接说你想做什么，或问问进展——我会自己判断该怎么帮你。";

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const syncStickToBottom = useCallback(() => {
    const el = threadRef.current;
    if (!el) return;
    stickToBottomRef.current = isNearBottom(el);
  }, []);

  useEffect(() => {
    if (skipNextScrollRef.current) {
      skipNextScrollRef.current = false;
      prevMessageCountRef.current = messages.length;
      return;
    }
    const grew = messages.length > prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;
    if (!grew || !stickToBottomRef.current) return;
    scrollToBottom("auto");
  }, [messages, scrollToBottom]);

  useEffect(() => {
    let cancelled = false;
    skipNextScrollRef.current = true;
    if (threadRef.current) {
      threadRef.current.scrollTop = 0;
    }
    void api.getCoachMessages(selectedGoal?.id).then(({ messages: loaded }) => {
      if (cancelled) return;
      skipNextScrollRef.current = true;
      if (loaded.length === 0) {
        setMessages([{ role: "coach", text: defaultCoachGreeting }]);
        return;
      }
      setMessages(
        loaded.map((m) => ({
          id: m.id,
          role: m.role,
          text: m.text,
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [selectedGoal?.id]);

  useEffect(() => {
    if (!coachReplyEvent) return;
    if (lastCoachReplyTsRef.current === coachReplyEvent.timestamp) return;
    lastCoachReplyTsRef.current = coachReplyEvent.timestamp;

    stickToBottomRef.current = true;
    setMessages((m) => {
      const last = m[m.length - 1];
      if (last?.role === "coach" && last.text === coachReplyEvent.message) return m;
      return [
        ...m,
        {
          role: "coach",
          text: coachReplyEvent.message,
          warn: coachReplyEvent.meta?.quotaExceeded,
        },
      ];
    });
    if (coachReplyEvent.refined) {
      setRefinedPreview(coachReplyEvent.refined);
    }
  }, [coachReplyEvent]);

  useEffect(() => {
    if (!refinedPreview) {
      setRecommendedExecutor(null);
      return;
    }
    let cancelled = false;
    void api
      .recommendExecutor({
        title: refinedPreview.title,
        acceptance: refinedPreview.acceptance,
        executionPrompt: refinedPreview.executionPrompt,
        userDraft: lastUserDraft || refinedPreview.title,
      })
      .then(({ recommendation }) => {
        if (cancelled || !recommendation) return;
        setRecommendedExecutor({
          id: recommendation.executorId,
          reason: recommendation.reason,
        });
      })
      .catch(() => {
        if (!cancelled) setRecommendedExecutor(null);
      });
    return () => {
      cancelled = true;
    };
  }, [refinedPreview, lastUserDraft]);

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    stickToBottomRef.current = true;
    setMessages((m) => [...m, { role: "user", text }]);
    setLastUserDraft(text);
    setDraft("");
    setRefinedPreview(null);
    setLoading(true);
    try {
      const { message, refined, meta } = await api.coachChat(
        text,
        selectedGoal?.id,
        chatSkillIds.length > 0 ? chatSkillIds : undefined,
      );
      stickToBottomRef.current = true;
      setMessages((m) => [
        ...m,
        {
          role: "coach",
          text: message,
          warn: meta?.quotaExceeded,
        },
      ]);
      if (refined) {
        setRefinedPreview(refined);
      }
    } finally {
      setLoading(false);
    }
  };

  const applyRefineToGoal = async () => {
    if (!selectedGoal || !refinedPreview) return;
    setLoading(true);
    try {
      await api.patchGoal(selectedGoal.id, refinedPreview);
      onRefreshed();
      setRefinedPreview(null);
      stickToBottomRef.current = true;
      setMessages((m) => [
        ...m,
        { role: "coach", text: `已更新目标「${selectedGoal.title}」。` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const createGoalFromRefined = async () => {
    if (!refinedPreview) return;
    setLoading(true);
    try {
      const subGoals = refinedPreview.subGoals?.length
        ? mapRefinedSubGoals(refinedPreview.subGoals, executorId)
        : undefined;
      const { goal, children } = await api.createGoal({
        userDraft: lastUserDraft || refinedPreview.title,
        executorId,
        title: refinedPreview.title,
        acceptance: refinedPreview.acceptance,
        executionPrompt: refinedPreview.executionPrompt,
        constraints: refinedPreview.constraints,
        subGoals,
        autoStart: autoExecute,
      });
      setRefinedPreview(null);
      onRefreshed();
      stickToBottomRef.current = true;
      const childNote =
        children && children.length > 0 ? `，含 ${children.length} 个子任务` : "";
      setMessages((m) => [
        ...m,
        {
          role: "coach",
          text: autoExecute
            ? `已创建并启动目标「${goal.title}」${childNote}。`
            : `已创建目标「${goal.title}」${childNote}，可在任务区手动启动。`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const createSubGoalsFromRefined = async () => {
    if (!refinedPreview?.subGoals?.length) return;
    const northStar = selectedGoal
      ? resolveNorthStar(goals, selectedGoal.id)
      : undefined;
    if (!northStar) {
      stickToBottomRef.current = true;
      setMessages((m) => [
        ...m,
        {
          role: "coach",
          text: "请先在任务区选择核心目标或其子任务，再创建子任务。",
        },
      ]);
      return;
    }
    setLoading(true);
    try {
      const { children } = await api.addSubGoals(
        northStar.id,
        mapRefinedSubGoals(refinedPreview.subGoals, executorId),
        autoExecute,
      );
      setRefinedPreview(null);
      onRefreshed();
      stickToBottomRef.current = true;
      setMessages((m) => [
        ...m,
        {
          role: "coach",
          text: autoExecute
            ? `已在「${northStar.title}」下创建并启动 ${children.length} 个子任务。`
            : `已在「${northStar.title}」下创建 ${children.length} 个子任务。`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const hasSubGoals = (refinedPreview?.subGoals?.length ?? 0) > 0;
  const canAttachSubGoals = hasSubGoals && Boolean(selectedGoal);

  return (
    <section className="mech-panel chat-panel">
      <div className="mech-panel-head">
        <h3>助手</h3>
      </div>
      <div className="chat-panel-body">
        <div
          ref={threadRef}
          className="chat-scroll-region"
          onScroll={syncStickToBottom}
        >
          <div className="chat-column chat-thread">
            {messages.map((m, i) => (
              <div
                key={m.id ?? `local-${i}-${m.role}-${m.text.slice(0, 24)}`}
                className={`chat-turn chat-turn-${m.role}`}
              >
                <div className={`chat-bubble ${m.role}${m.warn ? " warn" : ""}`}>
                  {renderChatMessageText(m.text, m.role === "user")}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="chat-dock">
          <div className="chat-column chat-dock-inner">
            {refinedPreview && (
              <div className="chat-dock-preview">
                <ExecutorPicker
                  value={executorId}
                  onChange={setExecutorId}
                  executors={executors}
                  label="派单执行器"
                  recommendedId={recommendedExecutor?.id}
                  recommendReason={recommendedExecutor?.reason}
                />
                <RefinedPreviewCard
                  refined={refinedPreview}
                  selectedGoalTitle={selectedGoal?.title}
                  applying={loading}
                  onApply={
                    selectedGoal && !hasSubGoals
                      ? () => void applyRefineToGoal()
                      : undefined
                  }
                  onCreate={
                    !selectedGoal || hasSubGoals
                      ? () => void createGoalFromRefined()
                      : undefined
                  }
                  onCreateSubGoals={
                    canAttachSubGoals
                      ? () => void createSubGoalsFromRefined()
                      : undefined
                  }
                  creating={loading}
                  autoExecute={autoExecute}
                />
              </div>
            )}

            <div className="chat-composer">
              <ChatContextPicker
                skillCatalog={catalogSkills}
                onContextChange={handleContextChange}
              />
              <textarea
                className="mech-textarea"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="说你想推进的事、问进展、或描述一个新目标…"
                rows={3}
              />
              <div className="chat-composer-actions">
                <button
                  type="button"
                  className="btn primary"
                  disabled={loading || !draft.trim()}
                  onClick={() => void send()}
                >
                  {loading ? "思考中…" : "发送"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
