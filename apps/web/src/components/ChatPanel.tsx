import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CoachMessageRecord, Goal, GoalRunState } from "@openx/shared";
import { DEFAULT_EXECUTION_AGENT_ID } from "@openx/shared";
import { api, type ExecutorInfo } from "../api";
import { defaultExecutorChoice } from "../lib/executors";
import { ChatWorkOrderCard } from "./ChatWorkOrderCard";
import { ChatClarifyCard } from "./ChatClarifyCard";
import { ChatOperatorActionCard } from "./ChatOperatorActionCard";
import { ChatContextPicker } from "./ChatContextPicker";
import { ChatExecutionCard } from "./ChatExecutionCard";
import { ChatTaskChip } from "./ChatTaskChip";
import { useSkillCatalog } from "../lib/use-skill-catalog";
import { renderChatMessageText } from "../lib/chat-message-format";
import {
  appendCoachRecord,
  buildDisplayThreadItems,
  findActiveRefinedRecordId,
  findLatestPendingClarifyRecord,
  findLatestPendingRefinedRecord,
  findClarifyRecordById,
  findRefinedRecordById,
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
  findDismissedClarifyRecordIds,
  findDismissedRefinedRecordIds,
  findResolvedClarifyRecordIds,
  isWorkOrderDismissMessage,
  shouldTryLlmClarify,
  shouldUseCoachStreaming,
} from "@openx/shared";
import type {
  ClarifyAnswerAnnotation,
  ClarifyAnswerValue,
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
  const [operatorActionLoading, setOperatorActionLoading] = useState<number | null>(
    null,
  );
  const [loadingMode, setLoadingMode] = useState<"streaming" | "structuring">(
    "streaming",
  );
  const [structuringKind, setStructuringKind] = useState<"clarify" | "refine">(
    "refine",
  );
  const [clarifyLoadingId, setClarifyLoadingId] = useState<number | null>(null);
  const [lastUserDraft, setLastUserDraft] = useState("");
  const [refineSuggestion, setRefineSuggestion] = useState<string | null>(null);
  const [cancelledRefinedIds, setCancelledRefinedIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [chatSkillIds, setChatSkillIds] = useState<string[]>([]);
  const [chatMcpIds, setChatMcpIds] = useState<string[]>([]);
  const [chatPermissionMode, setChatPermissionMode] = useState<
    import("@openx/shared").DispatchPermissionMode | undefined
  >(undefined);
  const [recommendedExecutor, setRecommendedExecutor] = useState<{
    id: string;
    reason: string;
  } | null>(null);
  const { skills: catalogSkills } = useSkillCatalog();
  const lastCoachReplyTsRef = useRef<string | null>(null);
  const lastCoachMessageIdRef = useRef<number | null>(null);
  const suppressRefinedRef = useRef(false);
  const cancelledRefinedIdsRef = useRef(cancelledRefinedIds);
  cancelledRefinedIdsRef.current = cancelledRefinedIds;
  const goalsRef = useRef(goals);
  goalsRef.current = goals;
  const chatCtxRef = useRef({
    mcpIds: chatMcpIds,
    skillIds: chatSkillIds,
    permissionMode: chatPermissionMode,
  });
  chatCtxRef.current = {
    mcpIds: chatMcpIds,
    skillIds: chatSkillIds,
    permissionMode: chatPermissionMode,
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
      permissionMode,
    }: {
      skills: Record<string, boolean>;
      mcps: Record<string, boolean>;
      permissionMode?: import("@openx/shared").DispatchPermissionMode;
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
      setChatPermissionMode(permissionMode);
    },
    [],
  );

  useEffect(() => {
    setExecutorId(defaultExecutorChoice(executors, defaultExecutorId));
  }, [executors, defaultExecutorId]);

  const threadRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const skipNextScrollRef = useRef(false);
  const prevThreadCountRef = useRef(0);

  const defaultCoachGreeting =
    "直接说你想做什么，或问问进展——我会自己判断该怎么帮你。";

  const threadItems = useMemo(() => {
    if (threadRecords.length === 0) {
      return buildDisplayThreadItems([
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
    return buildDisplayThreadItems(threadRecords);
  }, [threadRecords, conversationId, defaultCoachGreeting]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const scrollToDock = useCallback((behavior: ScrollBehavior = "smooth") => {
    dockRef.current?.scrollIntoView({ behavior, block: "end" });
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
    if (chatPermissionMode) {
      const label =
        {
          read_only: "只读",
          ask_write: "写前确认",
          full: "完全授权",
        }[chatPermissionMode] ?? chatPermissionMode;
      parts.push(`权限·${label}`);
    }
    return parts.length ? `上下文：${parts.join(" · ")}` : "";
  }, [chatSkillIds, chatMcpIds, chatPermissionMode]);

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
    const ambiguous = shouldTryLlmClarify(text);
    setStructuringKind(ambiguous ? "clarify" : "refine");
    setLoadingMode(
      !ambiguous && shouldUseCoachStreaming(text) ? "streaming" : "structuring",
    );
    setLoading(true);
    try {
      const { suggestRefine, meta } = await api.coachChat(text, {
        conversationId,
        goalId: selectedGoal?.id,
        skillIds: chatSkillIds.length > 0 ? chatSkillIds : undefined,
        mcpIds: chatMcpIds.length > 0 ? chatMcpIds : undefined,
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
    setStructuringKind("refine");
    setLoadingMode("structuring");
    setLoading(true);
    stickToBottomRef.current = true;
    try {
      const { meta } = await api.coachChat(text, {
        conversationId,
        goalId: selectedGoal?.id,
        skillIds: chatSkillIds.length > 0 ? chatSkillIds : undefined,
        mcpIds: chatMcpIds.length > 0 ? chatMcpIds : undefined,
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
        agentId: refinedPreview.agentId ?? DEFAULT_EXECUTION_AGENT_ID,
        mcpIds: chatMcpIds,
        skillIds: chatSkillIds,
        permissionMode: chatPermissionMode,
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

  const confirmOperatorAction = async (messageId: number, actionId: string) => {
    setOperatorActionLoading(messageId);
    try {
      await api.confirmOperatorAction(actionId, messageId);
      await syncThread({ restorePreview: false });
      stickToBottomRef.current = true;
    } catch (e) {
      const errText = e instanceof Error ? e.message : "确认失败";
      appendLocalCoach(`操作确认失败：${errText}`, true);
    } finally {
      setOperatorActionLoading(null);
    }
  };

  const submitClarify = async (
    messageId: number,
    answers: Record<string, ClarifyAnswerValue>,
    annotations?: Record<string, ClarifyAnswerAnnotation>,
  ) => {
    setClarifyLoadingId(messageId);
    setStructuringKind("refine");
    setLoadingMode("structuring");
    setLoading(true);
    stickToBottomRef.current = true;
    try {
      const res = await api.respondClarify(messageId, {
        conversationId,
        outcome: "answered",
        answers,
        annotations,
      });
      if (res.refined) {
        setRefinedPreview(
          enrichRefinedWithChatContext(res.refined, chatCtxRef.current),
        );
      }
      await syncThread();
      stickToBottomRef.current = true;
      requestAnimationFrame(() => scrollToDock("smooth"));
      if (res.meta?.quotaExceeded || res.meta?.llmError) {
        const { messages } = await api.getCoachMessages(conversationId);
        const lastCoach = [...messages]
          .reverse()
          .find((r) => r.kind === "text" && r.role === "coach");
        if (lastCoach?.kind === "text") {
          setMessageWarnById((prev) => ({ ...prev, [lastCoach.id]: true }));
        }
      }
    } catch (e) {
      const errText = e instanceof Error ? e.message : "提交澄清失败";
      if (/已处理|409/.test(errText)) {
        await syncThread();
        appendLocalCoach("该澄清卡已处理。", true);
      } else {
        appendLocalCoach(`澄清提交失败：${errText}`, true);
      }
    } finally {
      setClarifyLoadingId(null);
      setLoading(false);
    }
  };

  const dismissClarify = async (messageId: number) => {
    setClarifyLoadingId(messageId);
    setLoadingMode("streaming");
    setLoading(true);
    stickToBottomRef.current = true;
    try {
      await api.respondClarify(messageId, {
        conversationId,
        outcome: "dismissed",
      });
      await syncThread({ restorePreview: false });
      stickToBottomRef.current = true;
    } catch (e) {
      const errText = e instanceof Error ? e.message : "跳过澄清失败";
      if (/已处理|409/.test(errText)) {
        await syncThread({ restorePreview: false });
      } else {
        appendLocalCoach(`跳过澄清失败：${errText}`, true);
      }
    } finally {
      setClarifyLoadingId(null);
      setLoading(false);
    }
  };

  const dismissOperatorAction = async (messageId: number, actionId: string) => {
    setOperatorActionLoading(messageId);
    try {
      await api.dismissOperatorAction(actionId, messageId);
      await syncThread({ restorePreview: false });
      stickToBottomRef.current = true;
    } catch (e) {
      const errText = e instanceof Error ? e.message : "取消失败";
      appendLocalCoach(`操作取消失败：${errText}`, true);
    } finally {
      setOperatorActionLoading(null);
    }
  };

  const dismissedClarifyIds = useMemo(
    () => findDismissedClarifyRecordIds(threadRecords),
    [threadRecords],
  );
  const resolvedClarifyIds = useMemo(
    () => findResolvedClarifyRecordIds(threadRecords),
    [threadRecords],
  );
  const activeClarifyRecord = useMemo(
    () => findLatestPendingClarifyRecord(threadRecords),
    [threadRecords],
  );
  const activeClarifyId = activeClarifyRecord?.id ?? null;

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

  const focusLinkedRefined = useCallback(
    (refinedRecordId: number) => {
      const record = findRefinedRecordById(threadRecords, refinedRecordId);
      if (!record) return;
      setRefinedPreview(
        enrichRefinedWithChatContext(record.refined, chatCtxRef.current),
      );
      setRefinedMessageId(record.id);
      stickToBottomRef.current = true;
    },
    [threadRecords],
  );

  const focusLinkedClarify = useCallback((clarifyRecordId: number) => {
    document.getElementById(`chat-clarify-${clarifyRecordId}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, []);

  const activeRefinedLinkedClarify = useMemo(() => {
    if (activeRefinedId == null) return null;
    const refined = findRefinedRecordById(threadRecords, activeRefinedId);
    if (!refined?.linkedClarifyMessageId) return null;
    return findClarifyRecordById(threadRecords, refined.linkedClarifyMessageId);
  }, [activeRefinedId, threadRecords]);

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
        sourceClarifyTitle={
          activeRefinedLinkedClarify
            ? (activeRefinedLinkedClarify.clarify.title ?? "澄清问题")
            : undefined
        }
        onViewSourceClarify={
          activeRefinedLinkedClarify
            ? () => focusLinkedClarify(activeRefinedLinkedClarify.id)
            : undefined
        }
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
              if (item.kind === "date_separator") {
                return (
                  <div key={item.key} className="chat-date-separator" role="separator">
                    <span>{item.label}</span>
                  </div>
                );
              }

              if (item.kind === "crew_exchange") {
                const { exchange } = item;
                return (
                  <div
                    key={item.key}
                    className={`chat-turn chat-crew-exchange chat-crew-${exchange.direction}`}
                  >
                    <div className="chat-crew-exchange-card">
                      <div className="chat-crew-exchange-head">
                        <span className="chat-crew-exchange-label">{exchange.label}</span>
                        <time className="chat-turn-time" dateTime={item.timestamp}>
                          {new Date(item.timestamp).toLocaleTimeString(undefined, {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      </div>
                      <p className="chat-crew-exchange-body">{exchange.summary}</p>
                    </div>
                  </div>
                );
              }

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
                    <div className="chat-turn-meta">
                      <span className="chat-turn-role">
                        {m.role === "user" ? "你" : "工头"}
                      </span>
                      {m.timestamp ? (
                        <time className="chat-turn-time" dateTime={m.timestamp}>
                          {new Date(m.timestamp).toLocaleTimeString(undefined, {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      ) : null}
                    </div>
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

              if (item.kind === "clarify") {
                if (dismissedClarifyIds.has(item.recordId)) {
                  return (
                    <div
                      key={item.key}
                      id={`chat-clarify-${item.recordId}`}
                      className="chat-turn chat-turn-refined"
                    >
                      <div className="chat-refined-snippet cancelled">
                        <span className="chat-refined-label">已跳过澄清</span>
                        <strong>{item.clarify.title ?? "澄清问题"}</strong>
                      </div>
                    </div>
                  );
                }
                if (
                  resolvedClarifyIds.has(item.recordId) &&
                  item.recordId !== activeClarifyId
                ) {
                  const linkedRefined =
                    item.linkedRefinedMessageId != null
                      ? findRefinedRecordById(threadRecords, item.linkedRefinedMessageId)
                      : null;
                  return (
                    <div
                      key={item.key}
                      id={`chat-clarify-${item.recordId}`}
                      className="chat-turn chat-turn-refined"
                    >
                      <div className="chat-refined-snippet superseded">
                        <span className="chat-refined-label">已回答澄清</span>
                        <strong>{item.clarify.title ?? "澄清问题"}</strong>
                        {linkedRefined ? (
                          <button
                            type="button"
                            className="btn link chat-clarify-linked-refined"
                            onClick={() => focusLinkedRefined(linkedRefined.id)}
                          >
                            查看任务单「{linkedRefined.refined.title}」
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                }
                if (item.recordId === activeClarifyId) {
                  return (
                    <div
                      key={item.key}
                      id={`chat-clarify-${item.recordId}`}
                      className="chat-turn chat-turn-refined"
                    >
                      <ChatClarifyCard
                        clarify={item.clarify}
                        loading={clarifyLoadingId === item.recordId || loading}
                        onSubmit={(answers, annotations) =>
                          void submitClarify(item.recordId, answers, annotations)
                        }
                        onDismiss={() => void dismissClarify(item.recordId)}
                      />
                    </div>
                  );
                }
                return (
                  <div
                    key={item.key}
                    id={`chat-clarify-${item.recordId}`}
                    className="chat-turn chat-turn-refined"
                  >
                    <div className="chat-refined-snippet superseded">
                      <span className="chat-refined-label">澄清草稿</span>
                      <strong>{item.clarify.title ?? "澄清问题"}</strong>
                      <span className="chat-refined-hint">已被后续澄清取代</span>
                    </div>
                  </div>
                );
              }

              if (item.kind === "operator_action") {
                return (
                  <div key={item.key} className="chat-turn chat-turn-refined">
                    <ChatOperatorActionCard
                      action={item.operatorAction}
                      loading={operatorActionLoading === item.recordId}
                      onConfirm={() =>
                        confirmOperatorAction(
                          item.recordId,
                          item.operatorAction.pendingActionId,
                        )
                      }
                      onDismiss={() =>
                        dismissOperatorAction(
                          item.recordId,
                          item.operatorAction.pendingActionId,
                        )
                      }
                    />
                  </div>
                );
              }

              if (item.kind === "refined" && item.linkedGoalId) {
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
                item.kind === "refined" &&
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

              if (item.kind === "refined" && item.recordId === activeRefinedId && refinedPreview) {
                return (
                  <div key={item.key} className="chat-turn chat-turn-refined">
                    {renderWorkOrderCard()}
                  </div>
                );
              }

              if (item.kind !== "refined") return null;

              const linkedClarify =
                item.linkedClarifyMessageId != null
                  ? findClarifyRecordById(threadRecords, item.linkedClarifyMessageId)
                  : null;

              return (
                <div key={item.key} className="chat-turn chat-turn-refined">
                  <div className="chat-refined-snippet superseded">
                    <span className="chat-refined-label">工单草稿</span>
                    <strong>{item.refined.title}</strong>
                    <p>{item.refined.acceptance}</p>
                    {linkedClarify ? (
                      <button
                        type="button"
                        className="btn link chat-workorder-source-clarify"
                        onClick={() => focusLinkedClarify(linkedClarify.id)}
                      >
                        来自澄清「{linkedClarify.clarify.title ?? "澄清问题"}」
                      </button>
                    ) : null}
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
                <div className="chat-turn-meta">
                  <span className="chat-turn-role">工头</span>
                  <span className="chat-stream-status">
                    {structuringKind === "clarify" ? "澄清中" : "整理任务单"}
                  </span>
                </div>
                <div className="chat-bubble coach chat-structuring-hint">
                  {structuringKind === "clarify"
                    ? "正在准备澄清问题…"
                    : "正在整理工单…"}
                </div>
              </div>
            )}
            {showCoachStreamBubble && activeCoachStream && (
              <div className="chat-turn chat-turn-coach">
                <div className="chat-turn-meta">
                  <span className="chat-turn-role">工头</span>
                  <span className="chat-stream-status">输出中</span>
                </div>
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

        <div className="chat-dock" ref={dockRef}>
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
            {!refinedPreview && !activeClarifyId && refineSuggestion && (
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
                      ? structuringKind === "clarify"
                        ? "准备澄清中…"
                        : "整理工单中…"
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
