import { useEffect, useMemo, useRef, useState } from "react";
import type { AiProfile, ConversationParticipant } from "@openx/shared";
import {
  DEFAULT_MODEL_REF,
  ROUNDTABLE_FOREMAN_PROFILE_ID,
  ROUNDTABLE_GENERAL_PROFILE_ID,
  ROUNDTABLE_MAX_PARALLEL_REPLIES,
  listConfiguredModelRefs,
  shortModelRefLabel,
} from "@openx/shared";
import { api } from "../../api";
import { useAppState } from "../../lib/app-state";
import { displaySeatCount as resolveDisplaySeatCount } from "../../lib/roundtable-composer-policy";

type Props = {
  conversationId: string;
  participants: ConversationParticipant[];
  onChange: (participants: ConversationParticipant[]) => void;
  onError: (message: string) => void;
  /** 当前会话是否已是圆桌模式；否则首次添加会静默 enable */
  roundtableActive?: boolean;
  /** 递增时强制关闭席位编辑器（与 Context banner 互斥） */
  collapseSignal?: number;
  onEditorOpenChange?: (open: boolean) => void;
  /** 首次静默开启圆桌成功后回调（岛通知等） */
  onRoundtableBootstrapped?: () => void;
};

type EditorTarget =
  | { kind: "edit"; participantId: string }
  | { kind: "add" }
  | null;

/** 工头 + 最多 ROUNDTABLE_MAX_PARALLEL_REPLIES 个发言席 */
export const ROUNDTABLE_MAX_SEATS = ROUNDTABLE_MAX_PARALLEL_REPLIES + 1;

function toUpsertPayload(list: ConversationParticipant[]) {
  return list.map((x, i) => ({
    id: x.id.startsWith("tmp-") ? undefined : x.id,
    profileId: x.profileId,
    displayName: x.displayName,
    modelRef: x.modelRef,
    enabled: x.enabled,
    capabilityIds: x.capabilityIds,
    sortOrder: i,
  }));
}

function profileOptionsForEditor(
  profiles: AiProfile[],
  editor: Exclude<EditorTarget, null>,
  editing: ConversationParticipant | null | undefined,
): AiProfile[] {
  if (editor.kind === "add") {
    return profiles.filter((p) => p.id !== ROUNDTABLE_FOREMAN_PROFILE_ID);
  }
  if (editing?.profileId === ROUNDTABLE_FOREMAN_PROFILE_ID) {
    return profiles.filter((p) => p.id === ROUNDTABLE_FOREMAN_PROFILE_ID);
  }
  return profiles.filter((p) => p.id !== ROUNDTABLE_FOREMAN_PROFILE_ID);
}

function seatAvatar(profileId: string, profiles: AiProfile[]): string {
  const avatar = profiles.find((p) => p.id === profileId)?.avatar;
  if (avatar) return avatar;
  return profileId === ROUNDTABLE_FOREMAN_PROFILE_ID ? "👷" : "🤖";
}

export function ParticipantBar({
  conversationId,
  participants,
  onChange,
  onError,
  roundtableActive = false,
  collapseSignal = 0,
  onEditorOpenChange,
  onRoundtableBootstrapped,
}: Props) {
  const { state, enableRoundtable } = useAppState();
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onEditorOpenChangeRef = useRef(onEditorOpenChange);
  onEditorOpenChangeRef.current = onEditorOpenChange;
  const onBootstrappedRef = useRef(onRoundtableBootstrapped);
  onBootstrappedRef.current = onRoundtableBootstrapped;
  const rootRef = useRef<HTMLDivElement>(null);

  const [profiles, setProfiles] = useState<AiProfile[]>([]);
  const [editor, setEditor] = useState<EditorTarget>(null);
  const [draftProfileId, setDraftProfileId] = useState(ROUNDTABLE_GENERAL_PROFILE_ID);
  const [draftModelRef, setDraftModelRef] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (collapseSignal > 0) setEditor(null);
  }, [collapseSignal]);

  useEffect(() => {
    onEditorOpenChangeRef.current?.(editor != null);
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditor(null);
    };
    const onDoc = (e: MouseEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) {
        setEditor(null);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [editor]);

  useEffect(() => {
    let cancelled = false;
    void api
      .listAiProfiles()
      .then((r) => {
        if (!cancelled) setProfiles(r.profiles);
      })
      .catch((err) =>
        onErrorRef.current(err instanceof Error ? err.message : String(err)),
      );
    return () => {
      cancelled = true;
    };
  }, []);

  const modelOptions = useMemo(() => {
    if (!state.settings) return [];
    return listConfiguredModelRefs(state.settings);
  }, [state.settings]);

  const coachRef =
    state.settings?.model?.coach?.trim() ||
    modelOptions[0]?.ref ||
    DEFAULT_MODEL_REF;

  const foremanPlaceholder = useMemo(() => {
    const fromProfiles = profiles.find((p) => p.id === ROUNDTABLE_FOREMAN_PROFILE_ID);
    return {
      name: fromProfiles?.name ?? "工头",
      avatar: fromProfiles?.avatar ?? "👷",
    };
  }, [profiles]);

  const save = async (next: ConversationParticipant[]) => {
    setBusy(true);
    try {
      const { participants: saved } = await api.putRoundtableParticipants(
        conversationId,
        toUpsertPayload(next),
      );
      onChange(saved);
      setEditor(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (p: ConversationParticipant) => {
    setEditor({ kind: "edit", participantId: p.id });
    setDraftProfileId(p.profileId);
    setDraftModelRef(p.modelRef);
  };

  const openAdd = () => {
    if (participants.length >= ROUNDTABLE_MAX_SEATS) {
      onError(`最多 ${ROUNDTABLE_MAX_SEATS} 个席位（含工头）`);
      return;
    }
    setEditor({ kind: "add" });
    setDraftProfileId(ROUNDTABLE_GENERAL_PROFILE_ID);
    setDraftModelRef(coachRef);
  };

  const applyEdit = async () => {
    if (!editor || editor.kind !== "edit") return;
    if (!draftModelRef.trim()) {
      onError("请选择模型");
      return;
    }
    const profile = profiles.find((x) => x.id === draftProfileId);
    const next = participants.map((p) => {
      if (p.id !== editor.participantId) return p;
      const profileChanged = p.profileId !== draftProfileId;
      const wasDefaultName =
        p.displayName === profiles.find((x) => x.id === p.profileId)?.name;
      return {
        ...p,
        profileId: draftProfileId,
        displayName:
          wasDefaultName && profile ? profile.name : p.displayName,
        modelRef: draftModelRef.trim(),
        capabilityIds:
          profileChanged && profile
            ? [...profile.defaultCapabilityIds]
            : p.capabilityIds,
      };
    });
    await save(next);
  };

  const applyAdd = async () => {
    const profile = profiles.find((x) => x.id === draftProfileId);
    if (!profile) {
      onError("请选择 Agent 画像");
      return;
    }
    if (!draftModelRef.trim()) {
      onError("请选择模型");
      return;
    }
    if (participants.length >= ROUNDTABLE_MAX_SEATS) {
      onError(`最多 ${ROUNDTABLE_MAX_SEATS} 个席位（含工头）`);
      return;
    }

    const newSeat: ConversationParticipant = {
      id: `tmp-${Date.now()}`,
      conversationId,
      profileId: profile.id,
      displayName: profile.name,
      modelRef: draftModelRef.trim(),
      enabled: true,
      capabilityIds: [...profile.defaultCapabilityIds],
      sortOrder: participants.length,
    };

    const bootstrapSeats = {
      participantSeats: [
        { profileId: ROUNDTABLE_FOREMAN_PROFILE_ID },
        {
          profileId: profile.id,
          modelRef: draftModelRef.trim(),
          displayName: profile.name,
        },
      ],
    };

    // 工头态或尚无席位：静默 enable，只播种「工头 + 所选 Agent」
    if (!roundtableActive || participants.length === 0) {
      setBusy(true);
      try {
        if (participants.length === 0) {
          const result = await enableRoundtable(conversationId, bootstrapSeats);
          if (!result) return;
          onChange(result.participants);
          setEditor(null);
          onBootstrappedRef.current?.();
          return;
        }
        const result = await enableRoundtable(conversationId);
        if (!result) return;
        onBootstrappedRef.current?.();
        await save([...participants, newSeat]);
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    await save([...participants, newSeat]);
  };

  const toggleMute = async (p: ConversationParticipant) => {
    if (p.profileId === ROUNDTABLE_FOREMAN_PROFILE_ID) return;
    await save(
      participants.map((x) =>
        x.id === p.id ? { ...x, enabled: !x.enabled } : x,
      ),
    );
  };

  const quickChangeModel = async (p: ConversationParticipant, modelRef: string) => {
    if (!modelRef.trim() || modelRef === p.modelRef) return;
    await save(
      participants.map((x) =>
        x.id === p.id ? { ...x, modelRef: modelRef.trim() } : x,
      ),
    );
  };

  const removeSeat = async (p: ConversationParticipant) => {
    if (p.profileId === ROUNDTABLE_FOREMAN_PROFILE_ID) {
      onError("工头席位不可移出");
      return;
    }
    await save(participants.filter((x) => x.id !== p.id));
  };

  const editing =
    editor?.kind === "edit"
      ? participants.find((p) => p.id === editor.participantId)
      : null;
  const isEditingForeman =
    editing?.profileId === ROUNDTABLE_FOREMAN_PROFILE_ID;
  const profileSelectOptions = editor
    ? profileOptionsForEditor(profiles, editor, editing)
    : [];
  const displaySeatCount = resolveDisplaySeatCount(participants.length);
  const canAdd = displaySeatCount < ROUNDTABLE_MAX_SEATS;

  return (
    <div className="roundtable-participant-bar is-seats-row" ref={rootRef}>
      <div className="roundtable-chips" role="list">
        {participants.length === 0 ? (
          <div role="listitem" className="roundtable-chip-group">
            <button
              type="button"
              className="roundtable-chip"
              title={`${foremanPlaceholder.name} · 默认席位`}
              disabled
            >
              <span aria-hidden>{foremanPlaceholder.avatar}</span>
              <span className="roundtable-chip-name">{foremanPlaceholder.name}</span>
            </button>
          </div>
        ) : null}
        {participants.map((p) => {
          const selected =
            editor?.kind === "edit" && editor.participantId === p.id;
          const isForeman = p.profileId === ROUNDTABLE_FOREMAN_PROFILE_ID;
          return (
            <div
              key={p.id}
              role="listitem"
              className={[
                "roundtable-chip-group",
                p.enabled ? "" : "is-muted",
                selected ? "is-selected" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <button
                type="button"
                className="roundtable-chip"
                title={`${p.displayName} · ${p.modelRef}${p.enabled ? "" : "（静音）"} — 点击编辑 Agent`}
                aria-pressed={selected}
                disabled={busy}
                onClick={() => openEdit(p)}
              >
                <span aria-hidden>{seatAvatar(p.profileId, profiles)}</span>
                <span className="roundtable-chip-name">{p.displayName}</span>
                {!p.enabled ? (
                  <span className="roundtable-chip-mute-badge" title="已静音">
                    静音
                  </span>
                ) : null}
              </button>
              <label className="roundtable-chip-model-wrap" title="更换本席模型">
                <span className="visually-hidden">模型</span>
                <select
                  className="roundtable-chip-model-select"
                  value={p.modelRef}
                  disabled={busy || modelOptions.length === 0}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    e.stopPropagation();
                    void quickChangeModel(p, e.target.value);
                  }}
                >
                  {p.modelRef &&
                  !modelOptions.some((m) => m.ref === p.modelRef) ? (
                    <option value={p.modelRef}>
                      {shortModelRefLabel(p.modelRef)}
                    </option>
                  ) : null}
                  {modelOptions.map((m) => (
                    <option key={m.ref} value={m.ref}>
                      {shortModelRefLabel(m.ref)}
                    </option>
                  ))}
                </select>
              </label>
              {!isForeman ? (
                <button
                  type="button"
                  className="roundtable-chip-mute-btn"
                  title={p.enabled ? "静音" : "开麦"}
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggleMute(p);
                  }}
                >
                  {p.enabled ? "静" : "麦"}
                </button>
              ) : null}
            </div>
          );
        })}
        <button
          type="button"
          className="roundtable-chip roundtable-chip-add"
          disabled={busy || !canAdd}
          title={
            canAdd
              ? `添加 Agent（席位 ${displaySeatCount}/${ROUNDTABLE_MAX_SEATS}）`
              : `最多 ${ROUNDTABLE_MAX_SEATS} 个席位`
          }
          onClick={openAdd}
        >
          + 添加
        </button>
        <span
          className="roundtable-seats-count"
          title="当前席位 / 上限（含工头）"
        >
          {displaySeatCount}/{ROUNDTABLE_MAX_SEATS}
        </span>
      </div>

      {editor ? (
        <div className="roundtable-seat-editor">
          <div className="roundtable-seat-editor-title">
            {editor.kind === "add"
              ? "添加 Agent"
              : `编辑席位 · ${editing?.displayName ?? ""}`}
          </div>
          <div className="roundtable-seat-editor-fields">
            <label>
              Agent
              <select
                value={draftProfileId}
                disabled={busy || isEditingForeman}
                onChange={(e) => setDraftProfileId(e.target.value)}
              >
                {profileSelectOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              模型
              <select
                value={draftModelRef}
                disabled={busy || modelOptions.length === 0}
                onChange={(e) => setDraftModelRef(e.target.value)}
              >
                {draftModelRef &&
                !modelOptions.some((m) => m.ref === draftModelRef) ? (
                  <option value={draftModelRef}>{draftModelRef}</option>
                ) : null}
                {modelOptions.length === 0 ? (
                  <option value="">未配置模型，请先到设置添加</option>
                ) : (
                  modelOptions.map((m) => (
                    <option key={m.ref} value={m.ref}>
                      {m.label}
                    </option>
                  ))
                )}
              </select>
            </label>
          </div>
          <div className="roundtable-seat-editor-actions">
            {editor.kind === "edit" && editing && !isEditingForeman ? (
              <button
                type="button"
                className="roundtable-seat-btn is-danger"
                disabled={busy}
                onClick={() => void removeSeat(editing)}
              >
                移出
              </button>
            ) : null}
            <span className="roundtable-seat-editor-spacer" />
            <button
              type="button"
              className="roundtable-seat-btn"
              disabled={busy}
              onClick={() => setEditor(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="roundtable-seat-btn is-primary"
              disabled={busy || (!draftModelRef.trim() && modelOptions.length > 0)}
              onClick={() =>
                void (editor.kind === "add" ? applyAdd() : applyEdit())
              }
            >
              保存
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
