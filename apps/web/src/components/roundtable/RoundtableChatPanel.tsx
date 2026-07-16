import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ChatRoundMode,
  ChatRoundOutputGoal,
  ChatRoundLength,
  CoachMessageRecord,
  ConversationParticipant,
  CreateChatRoundInput,
} from "@openx/shared";
import {
  ROUNDTABLE_ALL_PARTICIPANTS_ID,
  ROUNDTABLE_FOREMAN_PROFILE_ID,
  resolveTextSpeaker,
} from "@openx/shared";
import { api } from "../../api";
import type { RoundReplyStreamState } from "../../lib/app-state";
import { useAppState } from "../../lib/app-state";
import { renderChatMessageText } from "../../lib/chat-message-format";
import { parseRoundtableMentions } from "../../lib/roundtable-mentions";

type Props = {
  conversationId: string;
};

type MentionToken = { id: string; label: string };

export function RoundtableChatPanel({ conversationId }: Props) {
  const { state } = useAppState();
  const [participants, setParticipants] = useState<ConversationParticipant[]>([]);
  const [records, setRecords] = useState<CoachMessageRecord[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<ChatRoundMode>("direct");
  const [divergeOpen, setDivergeOpen] = useState(false);
  const [outputGoal, setOutputGoal] = useState<ChatRoundOutputGoal>("free");
  const [length, setLength] = useState<ChatRoundLength>("medium");
  const [synthesize, setSynthesize] = useState(true);
  const [sending, setSending] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [sourceMessageId, setSourceMessageId] = useState<number | undefined>();
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const roundStreams = state.roundStreams;
  const coachMessageEvent = state.coachMessageEvent;

  const reload = useCallback(async () => {
    const [{ participants: parts }, { messages }] = await Promise.all([
      api.getRoundtableParticipants(conversationId),
      api.getCoachMessages(conversationId),
    ]);
    setParticipants(parts);
    setRecords(messages);
  }, [conversationId]);

  useEffect(() => {
    void reload().catch((err) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }, [reload]);

  useEffect(() => {
    if (
      coachMessageEvent &&
      coachMessageEvent.conversationId === conversationId
    ) {
      void reload();
    }
  }, [coachMessageEvent, conversationId, reload]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [records, roundStreams]);

  const nameById = useMemo(() => {
    const m = new Map<string, ConversationParticipant>();
    for (const p of participants) m.set(p.id, p);
    return m;
  }, [participants]);

  const mentionCandidates = useMemo(() => {
    const q = mentionFilter.trim().toLowerCase();
    const list = [
      { id: ROUNDTABLE_ALL_PARTICIPANTS_ID, label: "全体" },
      ...participants
        .filter((p) => p.enabled)
        .map((p) => ({ id: p.id, label: p.displayName })),
    ];
    if (!q) return list;
    return list.filter((x) => x.label.toLowerCase().includes(q));
  }, [participants, mentionFilter]);

  const estimatedCalls = useMemo(() => {
    const { mentionIds } = parseRoundtableMentions(input, participants);
    let n = 0;
    if (mode === "diverge") {
      if (mentionIds.includes(ROUNDTABLE_ALL_PARTICIPANTS_ID)) {
        n = participants.filter(
          (p) => p.enabled && p.profileId !== ROUNDTABLE_FOREMAN_PROFILE_ID,
        ).length;
      } else if (mentionIds.length > 0) {
        n = mentionIds.length;
      } else {
        n = Math.min(
          3,
          participants.filter(
            (p) => p.enabled && p.profileId !== ROUNDTABLE_FOREMAN_PROFILE_ID,
          ).length,
        );
      }
      if (synthesize) n += 1;
    } else if (mentionIds.length === 0) {
      n = 1;
    } else if (mentionIds.includes(ROUNDTABLE_ALL_PARTICIPANTS_ID)) {
      n = participants.filter(
        (p) => p.enabled && p.profileId !== ROUNDTABLE_FOREMAN_PROFILE_ID,
      ).length;
    } else {
      n = mentionIds.length;
    }
    return n;
  }, [input, mode, participants, synthesize]);

  const onInputChange = (value: string) => {
    setInput(value);
    const at = value.lastIndexOf("@");
    if (at >= 0 && (at === 0 || /\s/.test(value[at - 1] ?? ""))) {
      setMentionOpen(true);
      setMentionFilter(value.slice(at + 1));
    } else {
      setMentionOpen(false);
      setMentionFilter("");
    }
  };

  const insertMention = (token: MentionToken) => {
    const at = input.lastIndexOf("@");
    const next =
      at >= 0
        ? `${input.slice(0, at)}@${token.label} `
        : `${input}@${token.label} `;
    setInput(next);
    setMentionOpen(false);
    inputRef.current?.focus();
  };

  const toggleMute = async (p: ConversationParticipant) => {
    const next = participants.map((x) =>
      x.id === p.id ? { ...x, enabled: !x.enabled } : x,
    );
    const { participants: saved } = await api.putRoundtableParticipants(
      conversationId,
      next.map((x) => ({
        id: x.id,
        profileId: x.profileId,
        displayName: x.displayName,
        modelRef: x.modelRef,
        enabled: x.enabled,
        capabilityIds: x.capabilityIds,
        sortOrder: x.sortOrder,
      })),
    );
    setParticipants(saved);
  };

  const send = async () => {
    const raw = input.trim();
    if (!raw || sending) return;
    setSending(true);
    setError(null);
    try {
      const { cleanMessage, mentionIds } = parseRoundtableMentions(raw, participants);
      const body: CreateChatRoundInput = {
        message: cleanMessage || raw,
        mode,
        mentionParticipantIds: mentionIds,
        sourceMessageId,
        synthesize: mode === "diverge" ? synthesize : false,
        outputGoal: mode === "diverge" ? outputGoal : undefined,
        length: mode === "diverge" ? length : undefined,
      };
      await api.createChatRound(conversationId, body);
      setInput("");
      setSourceMessageId(undefined);
      setMode("direct");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const divergeFromMessage = (messageId: number) => {
    setSourceMessageId(messageId);
    setMode("diverge");
    setDivergeOpen(true);
    inputRef.current?.focus();
  };

  const askOthers = (messageId: number) => {
    setSourceMessageId(messageId);
    setMode("diverge");
    setInput("@全体 ");
    inputRef.current?.focus();
  };

  return (
    <div className="roundtable-panel chat-panel">
      <header className="roundtable-header">
        <div className="roundtable-header-row">
          <strong>AI 圆桌</strong>
          <button
            type="button"
            className="roundtable-stop-all"
            title="停止本会话全部进行中的回答"
            onClick={() => {
              void api
                .cancelActiveRoundtableRounds(conversationId)
                .then(() => reload())
                .catch((err) =>
                  setError(err instanceof Error ? err.message : String(err)),
                );
            }}
          >
            停止全部回答
          </button>
        </div>
        <div className="roundtable-chips">
          {participants.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`roundtable-chip${p.enabled ? "" : " is-muted"}`}
              title={`${p.displayName} · ${p.modelRef}`}
              onClick={() => void toggleMute(p)}
            >
              <span aria-hidden>{p.profileId === ROUNDTABLE_FOREMAN_PROFILE_ID ? "👷" : "🤖"}</span>
              {p.displayName}
              {!p.enabled ? "（静音）" : ""}
            </button>
          ))}
        </div>
      </header>

      <div className="roundtable-thread" ref={listRef}>
        {records.map((m) => {
          if (m.kind === "peer_request") {
            return (
              <PeerRequestCard
                key={m.id}
                record={m}
                onDone={() => void reload()}
                onError={(msg) => setError(msg)}
              />
            );
          }
          if (m.kind === "round_synthesis") {
            return (
              <RoundSynthesisCard
                key={m.id}
                record={m}
                onContinue={() => {
                  setMode("direct");
                  inputRef.current?.focus();
                }}
                onWorkOrder={() => {
                  void api
                    .roundToWorkOrder(m.synthesis.roundId)
                    .then(() => reload())
                    .catch((err) =>
                      setError(err instanceof Error ? err.message : String(err)),
                    );
                }}
              />
            );
          }
          if (m.kind !== "text") return null;
          const { speakerType, speakerId } = resolveTextSpeaker(m);
          const part = nameById.get(speakerId);
          const stream = roundStreams[m.id] as RoundReplyStreamState | undefined;
          const text =
            stream && stream.status === "streaming"
              ? stream.text || "…"
              : m.text || (stream?.text ?? "");
          const label =
            speakerType === "user"
              ? "用户"
              : part?.displayName ??
                (speakerType === "foreman" ? "工头助手" : speakerId);
          return (
            <article
              key={m.id}
              className={`roundtable-bubble speaker-${speakerType}`}
            >
              <header>
                <strong>{label}</strong>
                {m.generationMeta?.modelRef ? (
                  <span className="roundtable-model">{m.generationMeta.modelRef}</span>
                ) : null}
                {stream?.status === "streaming" ? (
                  <span className="roundtable-status">回复中…</span>
                ) : null}
                {m.generationStatus === "failed" || stream?.status === "failed" ? (
                  <span className="roundtable-status is-error">失败</span>
                ) : null}
              </header>
              <div className="roundtable-bubble-body">
                {renderChatMessageText(text)}
              </div>
              {(speakerType !== "user" &&
                (m.generationStatus === "completed" ||
                  m.generationStatus === "failed" ||
                  m.generationStatus === "streaming" ||
                  stream?.status === "streaming" ||
                  stream?.status === "failed")) ? (
                <footer className="roundtable-actions">
                  {m.generationStatus === "streaming" ||
                  stream?.status === "streaming" ? (
                    <button
                      type="button"
                      onClick={() =>
                        void api
                          .cancelRoundtableReply(m.id)
                          .then(() => reload())
                          .catch((err) =>
                            setError(err instanceof Error ? err.message : String(err)),
                          )
                      }
                    >
                      停止
                    </button>
                  ) : null}
                  {m.generationStatus === "completed" ? (
                    <>
                      <button type="button" onClick={() => {
                        setInput(`@${label} `);
                        setSourceMessageId(m.id);
                        inputRef.current?.focus();
                      }}>
                        追问它
                      </button>
                      <button type="button" onClick={() => askOthers(m.id)}>
                        让其他 AI 评价
                      </button>
                      <button type="button" onClick={() => divergeFromMessage(m.id)}>
                        基于此发散
                      </button>
                    </>
                  ) : null}
                  {m.generationStatus === "failed" || stream?.status === "failed" ? (
                    <button
                      type="button"
                      onClick={() => void api.retryRoundtableReply(m.id).then(reload)}
                    >
                      重试
                    </button>
                  ) : null}
                </footer>
              ) : null}
            </article>
          );
        })}
      </div>

      {error ? <p className="roundtable-error">{error}</p> : null}

      <footer className="roundtable-composer">
        <div className="roundtable-composer-toolbar">
          <label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as ChatRoundMode)}
            >
              <option value="direct">定向 / 常规</option>
              <option value="diverge">发散模式</option>
            </select>
          </label>
          {mode === "diverge" ? (
            <button type="button" onClick={() => setDivergeOpen((v) => !v)}>
              发散设置
            </button>
          ) : null}
          {sourceMessageId != null ? (
            <button type="button" onClick={() => setSourceMessageId(undefined)}>
              清除引用 #{sourceMessageId}
            </button>
          ) : null}
          <span className="roundtable-estimate">预计调用 {estimatedCalls} 次</span>
        </div>
        {divergeOpen && mode === "diverge" ? (
          <div className="roundtable-diverge-config">
            <label>
              目标
              <select
                value={outputGoal}
                onChange={(e) =>
                  setOutputGoal(e.target.value as ChatRoundOutputGoal)
                }
              >
                <option value="free">自由</option>
                <option value="ideas">想法</option>
                <option value="plans">方案</option>
                <option value="risks">风险</option>
                <option value="counterexamples">反例</option>
              </select>
            </label>
            <label>
              长度
              <select
                value={length}
                onChange={(e) => setLength(e.target.value as ChatRoundLength)}
              >
                <option value="short">短</option>
                <option value="medium">中</option>
                <option value="long">长</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={synthesize}
                onChange={(e) => setSynthesize(e.target.checked)}
              />
              工头总结
            </label>
          </div>
        ) : null}
        <div className="roundtable-input-wrap">
          {mentionOpen ? (
            <ul className="roundtable-mention-pop">
              {mentionCandidates.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => insertMention(c)}>
                    @{c.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <textarea
            ref={inputRef}
            value={input}
            rows={3}
            placeholder="输入问题，可用 @成员 或开启发散模式…"
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button type="button" disabled={sending || !input.trim()} onClick={() => void send()}>
            {sending ? "发送中…" : "发送"}
          </button>
        </div>
      </footer>
    </div>
  );
}

function PeerRequestCard(props: {
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
    <article className={`roundtable-peer-request${pending ? " is-pending" : ""}`}>
      <header>
        <strong>
          {req.fromDisplayName} 请求 {req.toDisplayName} 回答
        </strong>
        <span className="roundtable-status">{statusLabel}</span>
      </header>
      <p className="roundtable-peer-question">{req.question}</p>
      {pending ? (
        <footer className="roundtable-actions">
          <button
            type="button"
            onClick={() => {
              void api
                .rejectPeerRequest(req.id)
                .then(props.onDone)
                .catch((err) =>
                  props.onError(err instanceof Error ? err.message : String(err)),
                );
            }}
          >
            拒绝
          </button>
          <button
            type="button"
            onClick={() => {
              void api
                .approvePeerRequest(req.id)
                .then(props.onDone)
                .catch((err) =>
                  props.onError(err instanceof Error ? err.message : String(err)),
                );
            }}
          >
            同意
          </button>
          <button
            type="button"
            onClick={() => {
              void api
                .approveSessionPeerRequest(req.id)
                .then(props.onDone)
                .catch((err) =>
                  props.onError(err instanceof Error ? err.message : String(err)),
                );
            }}
          >
            本次会话同意
          </button>
        </footer>
      ) : null}
    </article>
  );
}

function RoundSynthesisCard(props: {
  record: Extract<CoachMessageRecord, { kind: "round_synthesis" }>;
  onContinue: () => void;
  onWorkOrder: () => void;
}) {
  const { synthesis } = props.record;
  return (
    <article className="roundtable-synthesis">
      <header>工头总结</header>
      <p>
        <strong>共识</strong>
        <br />
        {synthesis.consensus}
      </p>
      <p>
        <strong>分歧</strong>
        <br />
        {synthesis.disagreements || "（无明显分歧）"}
      </p>
      <p>
        <strong>推荐方案</strong>
        <br />
        {synthesis.recommendation}
      </p>
      <p>
        <strong>下一步</strong>
        <br />
        {synthesis.nextSteps}
      </p>
      <footer>
        <button type="button" onClick={props.onContinue}>
          继续讨论
        </button>
        <button type="button" onClick={props.onWorkOrder}>
          生成任务单
        </button>
      </footer>
    </article>
  );
}
