import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CoachMessageRecord, Goal, GoalRunState } from "@openx/shared";
import { api, type ExecutorInfo } from "../api";
import { defaultExecutorChoice } from "../lib/executors";
import { ChatWorkOrderCard } from "./ChatWorkOrderCard";
import { ChatContextPicker } from "./ChatContextPicker";
import { ChatExecutionCard } from "./ChatExecutionCard";
import { ChatTaskChip } from "./ChatTaskChip";
import { useSkillCatalog } from "../lib/use-skill-catalog";
import { useAgentCatalog } from "../lib/use-agent-catalog";
import { renderChatMessageText } from "../lib/chat-message-format";
import {
  appendCoachRecord,
  coachRecordsToThreadItems,
  findActiveRefinedRecordId,
  findLatestPendingRefinedRecord,
  pickLiveExecution,
} from "../lib/chat-thread";
import {
  mapRefinedSubGoals,
  resolveNorthStar,
  type RefinedPreviewState,
} from "../lib/goal-tree";
import {
  buildCreateGoalDispatch,
  enrichRefinedWithChatContext,
} from "../lib/dispatch-context";
import {
  EXECUTOR_AUTO,
  findDismissedRefinedRecordIds,
  isWorkOrderDismissMessage,
  shouldUseCoachStreaming,
} from "@openx/shared";
import type {
  CoachReplyEvent,
  CoachStreamState,
} from "../lib/app-state";

type Props = {
  conversationId: string;
  goals: Goal[];
  selectedGoal: Goal | undefined;
  runs: Record<string, GoalRunState>;
  autoExecute: boolean;
  executors: ExecutorInfo[];
  defaultExecutorId?: string;
  onRefreshed: () => void;
  onOpenGoalDetail?: (goalId: string) => void;
  onLocateGoal?: (goalId: string) => void;
  onStartGoal?: (id: string) => Promise<void>;
  onApproveGoal?: (id: string) => Promise<void>;
  onReworkGoal?: (id: string, reason?: string) => Promise<void>;
  coachReplyEvent?: CoachReplyEvent | null;
  coachStream?: CoachStreamState | null;
  coachMessageEvent?: CoachMessageRecord | null;
};

const SCROLL_STICK_THRESHOLD_PX = 48;

function isNearBottom(el: HTMLElement) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_STICK_THRESHOLD_PX;
}

export function ChatPanel({
  conversationId,
  goals,
  selectedGoal,
  runs,
  autoExecute,
  executors,
  defaultExecutorId,
  onRefreshed,
  onOpenGoalDetail,
  onLocateGoal,
  onStartGoal,
  onApproveGoal,
  onReworkGoal,
  coachReplyEvent,
  coachStream,
  coachMessageEvent,
}: Props) {
  const [draft, setDraft] = useState("");
  const [executorId, setExecutorId] = useState(() =>
    defaultExecutorChoice(executors, defaultExecutorId),
  );
  const [threadRecords, setThreadRecords] = useState<CoachMessageRecord[]>([]);
  const [messageWarnById, setMessageWarnById] = useState<Record<number, boolean>>({});
  const [refinedPreview, setRefinedPreview] = useState<RefinedPreviewState | null>(
    null,
  );
  const [refinedMessageId, setRefinedMessageId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMode, setLoadingMode] = useState<"streaming" | "structuring">(
    "streaming",
  );
  const [lastUserDraft, setLastUserDraft] = useState("");
  const [refineSuggestion, setRefineSuggestion] = useState<string | null>(null);
  const [cancelledRefinedIds, setCancelledRefinedIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [chatSkillIds, setChatSkillIds] = useState<string[]>([]);
  const [chatMcpIds, setChatMcpIds] = useState<string[]>([]);
  const [chatAgentId, setChatAgentId] = useState<string>("coach");
  const [recommendedExecutor, setRecommendedExecutor] = useState<{
    id: string;
    reason: string;
  } | null>(null);
  const { skills: catalogSkills } = useSkillCatalog();
  const { agents: coachAgents } = useAgentCatalog();
  const lastCoachReplyTsRef = useRef<string | null>(null);
  const lastCoachMessageIdRef = useRef<number | null>(null);
  const suppressRefinedRef = useRef(false);
  const cancelledRefinedIdsRef = useRef(cancelledRefinedIds);
  cancelledRefinedIdsRef.current = cancelledRefinedIds;
  const goalsRef = useRef(goals);
  goalsRef.current = goals;
  const chatCtxRef = useRef({
    agentId: chatAgentId,
    mcpIds: chatMcpIds,
    skillIds: chatSkillIds,
  });
  chatCtxRef.current = {
    agentId: chatAgentId,
    mcpIds: chatMcpIds,
    skillIds: chatSkillIds,
  };

  const syncThread = useCallback(
    async (opts?: { restorePreview?: boolean }) => {
      const { messages } = await api.getCoachMessages(conversationId);
      setThreadRecords(messages);
      if (opts?.restorePreview === false || suppressRefinedRef.current) return;
      const convGoals = goalsRef.current.filter(
        (g) => g.conversationId === conversationId,
      );
      const latest = findLatestPendingRefinedRecord(
        messages,
        convGoals,
        cancelledRefinedIdsRef.current,
      );
      setRefinedPreview(
        latest?.refined
          ? enrichRefinedWithChatContext(latest.refined, chatCtxRef.current)
          : null,
      );
      setRefinedMessageId(latest?.id ?? null);
    },
    [conversationId],
  );

  const conversationGoals = useMemo(
    () => goals.filter((g) => g.conversationId === conversationId),
    [goals, conversationId],
  );

  const handleContextChange = useCallback(
    ({
      skills,
      mcps,
      agentId,
    }: {
      skills: Record<string, boolean>;
      mcps: Record<string, boolean>;
      agentId: string;
    }) => {
      setChatSkillIds(
        Object.entries(skills)
          .filter(([, on]) => on)
          .map(([id]) => id),
      );
      setChatMcpIds(
        Object.entries(mcps)
          .filter(([, on]) => on)
          .map(([id]) => id),
      );
      setChatAgentId(agentId);
    },
    [],
  );

  useEffect(() => {
    setExecutorId(defaultExecutorChoice(executors, defaultExecutorId));
  }, [executors, defaultExecutorId]);

  const threadRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const skipNextScrollRef = useRef(false);
  const prevThreadCountRef = useRef(0);

  const defaultCoachGreeting =
    "直接说你想做什么，或问问进展——我会自己判断该怎么帮你。";

  const threadItems = useMemo(() => {
    if (threadRecords.length === 0) {
      return coachRecordsToThreadItems([
        {
          id: 0,
          conversationId,
          kind: "text",
          role: "coach",
          text: defaultCoachGreeting,
          timestamp: new Date(0).toISOString(),
        },
      ]);
    }
    return coachRecordsToThreadItems(threadRecords);
  }, [threadRecords, conversationId, defaultCoachGreeting]);

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
      prevThreadCountRef.current = threadItems.length;
      return;
    }
    const grew = threadItems.length > prevThreadCountRef.current;
    prevThreadCountRef.current = threadItems.length;
    if (!grew || !stickToBottomRef.current) return;
    scrollToBottom("auto");
  }, [threadItems.length, scrollToBottom]);

  useEffect(() => {
    let cancelled = false;
    skipNextScrollRef.current = true;
    lastCoachReplyTsRef.current = null;
    lastCoachMessageIdRef.current = null;
    if (threadRef.current) {
      threadRef.current.scrollTop = 0;
    }
    setRefineSuggestion(null);
    setCancelledRefinedIds(new Set());
    void api.getCoachMessages(conversationId).then(({ messages: loaded }) => {
      if (cancelled) return;
      skipNextScrollRef.current = true;
      setThreadRecords(loaded);
      setMessageWarnById({});
      const dismissed = findDismissedRefinedRecordIds(loaded);
      setCancelledRefinedIds(dismissed);
      const convGoals = goalsRef.current.filter(
        (g) => g.conversationId === conversationId,
      );
      const latestRefined = findLatestPendingRefinedRecord(
        loaded,
        convGoals,
        dismissed,
      );
      setRefinedPreview(
        latestRefined?.refined
          ? enrichRefinedWithChatContext(latestRefined.refined, chatCtxRef.current)
          : null,
      );
      setRefinedMessageId(latestRefined?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  useLayoutEffect(() => {
    if (!coachReplyEvent) return;
    if (coachReplyEvent.conversationId !== conversationId) return;
    if (lastCoachReplyTsRef.current === coachReplyEvent.timestamp) return;
    lastCoachReplyTsRef.current = coachReplyEvent.timestamp;

    stickToBottomRef.current = true;
    setLoading(false);
    setThreadRecords((records) =>
      appendCoachRecord(
        records,
        { role: "coach", text: coachReplyEvent.message },
        conversationId,
      ),
    );
    if (coachReplyEvent.suggestRefine) {
      setRefineSuggestion(lastUserDraft || null);
    } else {
      setRefineSuggestion(null);
    }
  }, [coachReplyEvent, conversationId, lastUserDraft]);

  useEffect(() => {
    if (!coachReplyEvent) return;
    if (coachReplyEvent.conversationId !== conversationId) return;
    if (lastCoachReplyTsRef.current !== coachReplyEvent.timestamp) return;

    void (async () => {
      await syncThread();
      if (coachReplyEvent.meta?.quotaExceeded || coachReplyEvent.meta?.llmError) {
        const { messages } = await api.getCoachMessages(conversationId);
        const lastCoach = [...messages]
          .reverse()
          .find((r) => r.kind === "text" && r.role === "coach");
        if (lastCoach?.kind === "text") {
          setMessageWarnById((prev) => ({ ...prev, [lastCoach.id]: true }));
        }
      }
    })();
  }, [coachReplyEvent, conversationId, syncThread]);

  useEffect(() => {
    if (!coachMessageEvent) return;
    if (coachMessageEvent.conversationId !== conversationId) return;
    if (lastCoachMessageIdRef.current === coachMessageEvent.id) return;
    lastCoachMessageIdRef.current = coachMessageEvent.id;
    stickToBottomRef.current = true;
    void syncThread();
  }, [coachMessageEvent, conversationId, syncThread]);

  const activeCoachStream =
    coachStream && coachStream.conversationId === conversationId
      ? coachStream
      : null;

  const showCoachStreamBubble = useMemo(() => {
    if (!activeCoachStream?.text) return false;
    for (let i = threadRecords.length - 1; i >= 0; i -= 1) {
      const row = threadRecords[i];
      if (row?.kind === "text" && row.role === "coach") {
        return row.text !== activeCoachStream.text;
      }
    }
    return true;
  }, [activeCoachStream, threadRecords]);

  useEffect(() => {
    if (!activeCoachStream || !stickToBottomRef.current) return;
    scrollToBottom("auto");
  }, [activeCoachStream, scrollToBottom]);

  const contextSummary = useMemo(() => {
    const parts: string[] = [];
    if (chatSkillIds.length) parts.push(`Skill×${chatSkillIds.length}`);
    if (chatMcpIds.length) parts.push(`MCP×${chatMcpIds.length}`);
    const agentName =
      coachAgents.find((a) => a.id === chatAgentId)?.name ?? chatAgentId;
    if (chatAgentId) parts.push(`Agent:${agentName}`);
    return parts.length ? `上下文：${parts.join(" · ")}` : "";
  }, [chatSkillIds, chatMcpIds, chatAgentId, coachAgents]);

  useEffect(() => {
    if (!refinedPreview) {
      setRecommendedExecutor(null);
      return;
    }
    if (defaultExecutorId !== EXECUTOR_AUTO) {
      setRecommendedExecutor(null);
      return;
    }
    if (refinedPreview.executorId) {
      setExecutorId(refinedPreview.executorId);
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
        setExecutorId(recommendation.executorId);
      })
      .catch(() => {
        if (!cancelled) setRecommendedExecutor(null);
      });
    return () => {
      cancelled = true;
    };
  }, [refinedPreview, lastUserDraft, defaultExecutorId]);

  const appendLocalCoach = useCallback(
    (text: string, warn = false) => {
      setThreadRecords((records) => {
        const next = appendCoachRecord(
          records,
          { role: "coach", text },
          conversationId,
        );
        if (warn) {
          const last = next[next.length - 1];
          if (last?.kind === "text") {
            setMessageWarnById((prev) => ({ ...prev, [last.id]: true }));
          }
        }
        return next;
      });
    },
    [conversationId],
  );

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    stickToBottomRef.current = true;
    setThreadRecords((records) =>
      appendCoachRecord(records, { role: "user", text }, conversationId),
    );
    setLastUserDraft(text);
    setDraft("");
    const dismiss = isWorkOrderDismissMessage(text);
    if (dismiss && refinedMessageId != null) {
      setCancelledRefinedIds((prev) => new Set(prev).add(refinedMessageId));
    }
    setRefinedPreview(null);
    setRefinedMessageId(null);
    setRefineSuggestion(null);
    setLoadingMode(shouldUseCoachStreaming(text) ? "streaming" : "structuring");
    setLoading(true);
    try {
      const { suggestRefine, meta } = await api.coachChat(text, {
        conversationId,
        goalId: selectedGoal?.id,
        skillIds: chatSkillIds.length > 0 ? chatSkillIds : undefined,
        mcpIds: chatMcpIds.length > 0 ? chatMcpIds : undefined,
        agentId: chatAgentId,
        skipRefine: dismiss || undefined,
      });
      if (suggestRefine) {
        setRefineSuggestion(text);
      } else {
        setRefineSuggestion(null);
      }
      await syncThread({ restorePreview: !dismiss });
      stickToBottomRef.current = true;
      if (meta?.quotaExceeded || meta?.llmError) {
        const { messages } = await api.getCoachMessages(conversationId);
        const lastCoach = [...messages]
          .reverse()
          .find((r) => r.kind === "text" && r.role === "coach");
        if (lastCoach?.kind === "text") {
          setMessageWarnById((prev) => ({ ...prev, [lastCoach.id]: true }));
        }
      }
    } catch (e) {
      const errText = e instanceof Error ? e.message : "发送失败";
      stickToBottomRef.current = true;
      appendLocalCoach(`发送失败：${errText}`, true);
    } finally {
      setLoading(false);
    }
  };

  const requestRefineFromSuggestion = async () => {
    const text = refineSuggestion;
    if (!text || loading) return;
    setRefineSuggestion(null);
    setLastUserDraft(text);
    setLoadingMode("structuring");
    setLoading(true);
    stickToBottomRef.current = true;
    try {
      const { meta } = await api.coachChat(text, {
        conversationId,
        goalId: selectedGoal?.id,
        skillIds: chatSkillIds.length > 0 ? chatSkillIds : undefined,
        mcpIds: chatMcpIds.length > 0 ? chatMcpIds : undefined,
        agentId: chatAgentId,
        forceRefine: true,
      });
      await syncThread();
      stickToBottomRef.current = true;
      if (meta?.quotaExceeded || meta?.llmError) {
        const { messages } = await api.getCoachMessages(conversationId);
        const lastCoach = [...messages]
          .reverse()
          .find((r) => r.kind === "text" && r.role === "coach");
        if (lastCoach?.kind === "text") {
          setMessageWarnById((prev) => ({ ...prev, [lastCoach.id]: true }));
        }
      }
    } catch (e) {
      const errText = e instanceof Error ? e.message : "整理失败";
      stickToBottomRef.current = true;
      appendLocalCoach(`整理任务单失败：${errText}`, true);
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
      setRefinedMessageId(null);
      stickToBottomRef.current = true;
      appendLocalCoach(`已更新目标「${selectedGoal.title}」。`);
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
      const execId =
        defaultExecutorId === EXECUTOR_AUTO
          ? (refinedPreview.executorId ?? executorId)
          : executorId;
      const dispatchContext = buildCreateGoalDispatch(refinedPreview, {
        agentId: chatAgentId,
        mcpIds: chatMcpIds,
        skillIds: chatSkillIds,
      });
      await api.createGoal({
        conversationId,
        userDraft: lastUserDraft || refinedPreview.title,
        executorId: execId,
        title: refinedPreview.title,
        acceptance: refinedPreview.acceptance,
        executionPrompt: refinedPreview.executionPrompt,
        constraints: refinedPreview.constraints,
        priority: refinedPreview.priority,
        subGoals,
        autoReview: true,
        autoStart: autoExecute,
        refinedMessageId: refinedMessageId ?? undefined,
        agentId: dispatchContext?.agentId,
        mcpIds: dispatchContext?.mcpIds,
        skillIds: dispatchContext?.skillIds,
        dispatchContext,
      });
      setRefinedPreview(null);
      setRefinedMessageId(null);
      await syncThread({ restorePreview: false });
      onRefreshed();
      stickToBottomRef.current = true;
    } finally {
      setLoading(false);
    }
  };

  const cancelWorkOrder = async () => {
    if (!refinedPreview || loading || refinedMessageId == null) return;
    const msgId = refinedMessageId;
    setRefinedPreview(null);
    setRefinedMessageId(null);
    setCancelledRefinedIds((prev) => new Set(prev).add(msgId));
    stickToBottomRef.current = true;
    suppressRefinedRef.current = true;
    setLoadingMode("streaming");
    setLoading(true);
    try {
      await api.respondRefinedWorkOrder(msgId, {
        conversationId,
        outcome: "dismissed",
      });
      await syncThread({ restorePreview: false });
      stickToBottomRef.current = true;
    } catch (e) {
      const errText = e instanceof Error ? e.message : "取消反馈失败";
      stickToBottomRef.current = true;
      appendLocalCoach(`已取消任务单。${errText}`, true);
    } finally {
      suppressRefinedRef.current = false;
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
      appendLocalCoach("请先在任务区选择核心目标或其子任务，再创建子任务。");
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
      setRefinedMessageId(null);
      onRefreshed();
      stickToBottomRef.current = true;
      appendLocalCoach(
        autoExecute
          ? `已在「${northStar.title}」下创建并启动 ${children.length} 个子任务。`
          : `已在「${northStar.title}」下创建 ${children.length} 个子任务。`,
      );
    } finally {
      setLoading(false);
    }
  };

  const hasSubGoals = (refinedPreview?.subGoals?.length ?? 0) > 0;
  const canAttachSubGoals = hasSubGoals && Boolean(selectedGoal);

  /** 已升级为任务芯片的 goalId：跳过独立执行卡片，避免重复 */
  const chipGoalIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of threadRecords) {
      if (r.kind === "refined" && r.linkedGoalId) ids.add(r.linkedGoalId);
    }
    return ids;
  }, [threadRecords]);

  /** 当前预览对应的 persisted refined 记录 id */
  const activeRefinedId = useMemo(() => {
    if (!refinedPreview) return null;
    return findActiveRefinedRecordId(
      threadRecords,
      refinedPreview,
      refinedMessageId,
    );
  }, [refinedPreview, refinedMessageId, threadRecords]);

  const renderWorkOrderCard = () => {
    if (!refinedPreview) return null;
    return (
      <ChatWorkOrderCard
        refined={refinedPreview}
        executorId={executorId}
        executors={executors}
        recommendedId={recommendedExecutor?.id}
        recommendReason={recommendedExecutor?.reason}
        onChange={setRefinedPreview}
        onExecutorChange={setExecutorId}
      />
    );
  };

  const workOrderCreateLabel = useMemo(() => {
    if (loading) return "处理中…";
    if (canAttachSubGoals) {
      return autoExecute
        ? `创建 ${refinedPreview?.subGoals?.length ?? 0} 个子任务并执行`
        : `创建 ${refinedPreview?.subGoals?.length ?? 0} 个子任务`;
    }
    if (selectedGoal && !hasSubGoals) {
      const t = selectedGoal.title;
      const short = t.length > 14 ? `${t.slice(0, 14)}…` : t;
      return `更新「${short}」`;
    }
    return autoExecute ? "创建并执行" : "创建";
  }, [
    loading,
    canAttachSubGoals,
    autoExecute,
    refinedPreview?.subGoals?.length,
    selectedGoal,
    hasSubGoals,
  ]);

  const handleWorkOrderCreate = () => {
    if (canAttachSubGoals) void createSubGoalsFromRefined();
    else if (selectedGoal && !hasSubGoals) void applyRefineToGoal();
    else void createGoalFromRefined();
  };

  const liveExecution = useMemo(
    () => pickLiveExecution(conversationGoals, runs, selectedGoal),
    [conversationGoals, runs, selectedGoal],
  );

  const executionTick = liveExecution
    ? `${liveExecution.run.liveText.length}:${liveExecution.run.events.length}:${liveExecution.run.active}`
    : "";

  useEffect(() => {
    if (!liveExecution || !stickToBottomRef.current) return;
    scrollToBottom("auto");
  }, [liveExecution, executionTick, scrollToBottom]);

  return (
    <section className="mech-panel chat-panel">
      <div className="chat-panel-body">
        <div className="workspace-pane-head" aria-hidden={!contextSummary}>
          <span className="workspace-pane-head-title">
            {contextSummary || "\u00a0"}
          </span>
        </div>
        <div
          ref={threadRef}
          className="chat-scroll-region"
          onScroll={syncStickToBottom}
        >
          <div className="chat-column chat-thread">
            {threadItems.map((item) => {
              if (item.kind === "message") {
                const m = item.message;
                const warn =
                  m.warn ||
                  (m.id != null ? messageWarnById[m.id] : false);
                return (
                  <div
                    key={item.key}
                    className={`chat-turn chat-turn-${m.role}`}
                  >
                    <div className={`chat-bubble ${m.role}${warn ? " warn" : ""}`}>
                      {renderChatMessageText(m.text, m.role === "user")}
                    </div>
                  </div>
                );
              }

              if (item.kind === "execution") {
                if (chipGoalIds.has(item.pin.goalId)) return null;
                const goal =
                  conversationGoals.find((g) => g.id === item.pin.goalId) ??
                  ({
                    id: item.pin.goalId,
                    title: item.pin.goalTitle,
                    status: item.pin.goalStatus,
                  } as Goal);

                return (
                  <ChatExecutionCard
                    key={item.key}
                    goal={goal}
                    run={item.pin.run}
                    onOpenDetail={
                      onOpenGoalDetail
                        ? () => onOpenGoalDetail(item.pin.goalId)
                        : undefined
                    }
                  />
                );
              }

              if (item.linkedGoalId) {
                const linkedId = item.linkedGoalId;
                const linkedGoal = goals.find((g) => g.id === linkedId);
                return (
                  <ChatTaskChip
                    key={item.key}
                    goal={linkedGoal}
                    fallbackTitle={item.refined.title}
                    onLocate={
                      onLocateGoal ? () => onLocateGoal(linkedId) : undefined
                    }
                    onOpenDetail={
                      onOpenGoalDetail
                        ? () => onOpenGoalDetail(linkedId)
                        : undefined
                    }
                    handlers={{
                      onStart: onStartGoal,
                      onApprove: onApproveGoal,
                      onRework: onReworkGoal,
                    }}
                  />
                );
              }

              if (
                item.recordId != null &&
                cancelledRefinedIds.has(item.recordId)
              ) {
                return (
                  <div key={item.key} className="chat-turn chat-turn-refined">
                    <div className="chat-refined-snippet cancelled">
                      <span className="chat-refined-label">已取消</span>
                      <strong>{item.refined.title}</strong>
                      <p>{item.refined.acceptance}</p>
                    </div>
                  </div>
                );
              }

              if (item.recordId === activeRefinedId && refinedPreview) {
                return (
                  <div key={item.key} className="chat-turn chat-turn-refined">
                    {renderWorkOrderCard()}
                  </div>
                );
              }

              return (
                <div key={item.key} className="chat-turn chat-turn-refined">
                  <div className="chat-refined-snippet superseded">
                    <span className="chat-refined-label">工单草稿</span>
                    <strong>{item.refined.title}</strong>
                    <p>{item.refined.acceptance}</p>
                    <span className="chat-refined-hint">未创建，已被后续工单取代</span>
                  </div>
                </div>
              );
            })}
            {refinedPreview && activeRefinedId == null && (
              <div className="chat-turn chat-turn-refined">
                {renderWorkOrderCard()}
              </div>
            )}
            {loading && loadingMode === "structuring" && !activeCoachStream && (
              <div className="chat-turn chat-turn-coach">
                <div className="chat-bubble coach chat-structuring-hint">
                  正在整理工单…
                </div>
              </div>
            )}
            {showCoachStreamBubble && activeCoachStream && (
              <div className="chat-turn chat-turn-coach">
                <div className="chat-bubble coach streaming">
                  {renderChatMessageText(activeCoachStream.text, false, {
                    streaming: true,
                  })}
                  <span className="chat-stream-cursor" aria-hidden="true" />
                </div>
              </div>
            )}
            {liveExecution && (
              <ChatExecutionCard
                goal={liveExecution.goal}
                run={liveExecution.run}
                onOpenDetail={
                  onOpenGoalDetail
                    ? () => onOpenGoalDetail(liveExecution.goal.id)
                    : undefined
                }
              />
            )}
          </div>
        </div>

        <div className="chat-dock">
          <div className="chat-dock-inner">
            {refinedPreview && (
              <div className="chat-dock-actions">
                <button
                  type="button"
                  className="btn primary"
                  disabled={loading}
                  onClick={() => handleWorkOrderCreate()}
                >
                  {workOrderCreateLabel}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={loading}
                  onClick={() => void cancelWorkOrder()}
                >
                  取消
                </button>
              </div>
            )}
            {!refinedPreview && refineSuggestion && (
              <div className="chat-dock-hint chat-suggest-bar">
                <span className="chat-dock-hint-text">
                  这条像可派发的任务，要整理成任务单吗？
                </span>
                <button
                  type="button"
                  className="btn compact primary"
                  disabled={loading}
                  onClick={() => void requestRefineFromSuggestion()}
                >
                  整理成任务单
                </button>
                <button
                  type="button"
                  className="btn compact"
                  onClick={() => setRefineSuggestion(null)}
                >
                  忽略
                </button>
              </div>
            )}

            <div className="chat-composer">
              <ChatContextPicker
                skillCatalog={catalogSkills}
                agentCatalog={coachAgents}
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
                rows={2}
              />
              <div className="chat-composer-actions">
                <button
                  type="button"
                  className="btn primary"
                  disabled={loading || !draft.trim()}
                  onClick={() => void send()}
                >
                  {loading
                    ? loadingMode === "structuring"
                      ? "整理工单中…"
                      : "回复中…"
                    : "发送"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
