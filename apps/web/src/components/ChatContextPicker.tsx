import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMcpCatalog } from "../lib/use-mcp-catalog";
import {
  COACH_SKILLS,
  countEnabled,
  loadMcpSelection,
  loadPermissionSelection,
  loadSkillSelection,
  permissionModeFromSelection,
  saveMcpSelection,
  savePermissionSelection,
  saveSkillSelection,
  type ChatPermissionSelection,
  type CoachSkill,
} from "../lib/coach-context";
import { PERMISSION_PICKER_OPTIONS } from "../lib/workflow-ui";
import type { KnowledgeSourceRef } from "@openx/shared";
import {
  buildKnowledgePickerItems,
  enabledMapToSelection,
  knowledgeSelectionLabel,
  loadKnowledgeSelection,
  saveKnowledgeSelection,
  selectionToEnabledMap,
} from "../lib/knowledge-context";

export type PickerTab = "skill" | "mcp" | "permission" | "knowledge";

type Props = {
  skillCatalog?: CoachSkill[];
  projectId?: string;
  isSystemMain?: boolean;
  globalSources?: KnowledgeSourceRef[];
  projectSources?: KnowledgeSourceRef[];
  /** 工具栏左侧插槽（保留 API；Composer 席位行不再使用） */
  leading?: ReactNode;
  trailing?: ReactNode;
  /** 有值则禁用 tabs 并展示说明（圆桌下 Context 未接入发送管线） */
  disabledReason?: string;
  /** 递增时强制关闭展开的 banner（与席位编辑互斥） */
  collapseSignal?: number;
  onBannerOpenChange?: (open: boolean) => void;
  onContextChange?: (ctx: {
    skills: Record<string, boolean>;
    mcps: Record<string, boolean>;
    permission: ChatPermissionSelection;
    permissionMode?: ReturnType<typeof permissionModeFromSelection>;
    knowledgeSelection: ReturnType<typeof loadKnowledgeSelection>;
  }) => void;
};

export function ChatContextPicker({
  skillCatalog = COACH_SKILLS,
  projectId,
  isSystemMain = false,
  globalSources = [],
  projectSources = [],
  leading,
  trailing,
  disabledReason,
  collapseSignal = 0,
  onBannerOpenChange,
  onContextChange,
}: Props) {
  const { mcps: mcpCatalog } = useMcpCatalog();
  const [openTab, setOpenTab] = useState<PickerTab | null>(null);
  const disabled = Boolean(disabledReason);
  const onBannerOpenChangeRef = useRef(onBannerOpenChange);
  onBannerOpenChangeRef.current = onBannerOpenChange;

  useEffect(() => {
    if (collapseSignal > 0) setOpenTab(null);
  }, [collapseSignal]);

  useEffect(() => {
    if (disabled) setOpenTab(null);
  }, [disabled]);

  useEffect(() => {
    onBannerOpenChangeRef.current?.(openTab != null);
  }, [openTab]);

  const [skills, setSkills] = useState(() => loadSkillSelection(skillCatalog));
  const [mcps, setMcps] = useState(() => loadMcpSelection(mcpCatalog));
  const globalSourceKey = globalSources.map((s) => s.id).join("|");
  const projectSourceKey = projectSources.map((s) => s.id).join("|");
  const knowledgeItems = useMemo(
    () =>
      buildKnowledgePickerItems({
        isSystemMain,
        globalSources,
        projectSources,
      }),
    [isSystemMain, globalSourceKey, projectSourceKey, globalSources, projectSources],
  );
  const [knowledgeEnabled, setKnowledgeEnabled] = useState(() =>
    selectionToEnabledMap(knowledgeItems, loadKnowledgeSelection(projectId)),
  );

  useEffect(() => {
    setKnowledgeEnabled(
      selectionToEnabledMap(knowledgeItems, loadKnowledgeSelection(projectId)),
    );
  }, [projectId, knowledgeItems]);

  const [permission, setPermission] = useState<ChatPermissionSelection>(() =>
    loadPermissionSelection(),
  );
  const knowledgeSelection = useMemo(
    () => enabledMapToSelection(knowledgeItems, knowledgeEnabled),
    [knowledgeItems, knowledgeEnabled],
  );
  const knowledgeCount = countEnabled(knowledgeEnabled);
  const knowledgeLabel = knowledgeSelectionLabel(
    knowledgeSelection,
    knowledgeCount,
    knowledgeItems.length,
  );

  useEffect(() => {
    setSkills(loadSkillSelection(skillCatalog));
  }, [skillCatalog.map((s) => `${s.id}:${s.installed}`).join("|")]);

  useEffect(() => {
    setMcps(loadMcpSelection(mcpCatalog));
  }, [mcpCatalog.map((m) => m.id).join("|")]);

  const footerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [panning, setPanning] = useState(false);

  const onContextChangeRef = useRef(onContextChange);
  onContextChangeRef.current = onContextChange;
  const lastContextPayloadRef = useRef("");

  useEffect(() => {
    const payload = JSON.stringify({ skills, mcps, permission, knowledgeSelection });
    if (payload === lastContextPayloadRef.current) return;
    lastContextPayloadRef.current = payload;
    onContextChangeRef.current?.({
      skills,
      mcps,
      permission,
      permissionMode: permissionModeFromSelection(permission),
      knowledgeSelection,
    });
  }, [skills, mcps, permission, knowledgeSelection]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (e.button === 1) return;
      if (!footerRef.current?.contains(e.target as Node)) {
        setOpenTab(null);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el || !openTab) return;

    const canScroll = () => el.scrollWidth > el.clientWidth + 1;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 1 || !canScroll()) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startScroll = el.scrollLeft;
      setPanning(true);

      const onMove = (ev: MouseEvent) => {
        ev.preventDefault();
        el.scrollLeft = startScroll - (ev.clientX - startX);
      };

      const onUp = () => {
        setPanning(false);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    };

    const onWheel = (e: WheelEvent) => {
      if (!canScroll()) return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      e.preventDefault();
      el.scrollLeft += delta;
    };

    el.addEventListener("mousedown", onMouseDown, { capture: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("mousedown", onMouseDown, { capture: true });
      el.removeEventListener("wheel", onWheel);
    };
  }, [openTab]);

  const toggleTab = (tab: PickerTab) => {
    if (disabled) return;
    setOpenTab((prev) => (prev === tab ? null : tab));
  };

  const toggleSkill = (id: string) => {
    const next = { ...skills, [id]: !skills[id] };
    setSkills(next);
    saveSkillSelection(next, skillCatalog);
  };

  const toggleMcp = (id: string) => {
    const next = { ...mcps, [id]: !mcps[id] };
    setMcps(next);
    saveMcpSelection(next);
  };

  const selectPermission = (mode: ChatPermissionSelection) => {
    setPermission(mode);
    savePermissionSelection(mode);
  };

  const toggleKnowledge = (id: string) => {
    const next = { ...knowledgeEnabled, [id]: !knowledgeEnabled[id] };
    setKnowledgeEnabled(next);
    saveKnowledgeSelection(enabledMapToSelection(knowledgeItems, next), projectId);
  };

  const selectAllKnowledge = () => {
    const next = Object.fromEntries(knowledgeItems.map((item) => [item.id, true]));
    setKnowledgeEnabled(next);
    saveKnowledgeSelection({ mode: "all" }, projectId);
  };

  const skillCount = countEnabled(skills);
  const mcpCount = countEnabled(mcps);
  const permissionLabel =
    permission === "default"
      ? ""
      : PERMISSION_PICKER_OPTIONS.find((o) => o.id === permission)?.label ?? "";

  return (
    <div
      className={`chat-context-picker${disabled ? " is-disabled" : ""}`}
      ref={footerRef}
      title={disabledReason}
    >
      <div className="chat-context-tabs" aria-disabled={disabled || undefined}>
        {leading ? (
          <div className="chat-context-leading">{leading}</div>
        ) : null}
        <button
          type="button"
          className={`chat-context-tab${openTab === "skill" ? " open" : ""}`}
          aria-expanded={openTab === "skill"}
          disabled={disabled}
          title={disabledReason ?? undefined}
          onClick={() => toggleTab("skill")}
        >
          Skill{skillCount > 0 ? ` ${skillCount}` : ""}
        </button>
        <button
          type="button"
          className={`chat-context-tab${openTab === "mcp" ? " open" : ""}`}
          aria-expanded={openTab === "mcp"}
          disabled={disabled}
          title={disabledReason ?? undefined}
          onClick={() => toggleTab("mcp")}
        >
          MCP{mcpCount > 0 ? ` ${mcpCount}` : ""}
        </button>
        <button
          type="button"
          className={`chat-context-tab chat-context-tab-permission${openTab === "permission" ? " open" : ""}${permission !== "default" ? " active-selection" : ""}`}
          aria-expanded={openTab === "permission"}
          disabled={disabled}
          onClick={() => toggleTab("permission")}
          title={disabledReason ?? "派单权限模式"}
        >
          权限{permissionLabel ? ` · ${permissionLabel}` : ""}
        </button>
        <button
          type="button"
          className={`chat-context-tab${openTab === "knowledge" ? " open" : ""}${knowledgeSelection.mode === "all" ? " active-selection" : ""}`}
          aria-expanded={openTab === "knowledge"}
          disabled={disabled}
          onClick={() => toggleTab("knowledge")}
          title={disabledReason ?? "本次对话包含的知识库"}
        >
          知识 · {knowledgeLabel}
        </button>
        {trailing ? (
          <div className="chat-context-trailing">{trailing}</div>
        ) : null}
      </div>

      {openTab && !disabled && (
        <div className="chat-context-banner" role="listbox" aria-label="上下文选择">
          <div className="chat-context-banner-head">
            <span className="chat-context-banner-title">
              {openTab === "skill" && "选择 Skills"}
              {openTab === "mcp" && "选择 MCP"}
              {openTab === "permission" && "派单权限"}
              {openTab === "knowledge" && "选择知识库"}
            </span>
            <span className="chat-context-banner-hint">
              {openTab === "permission" ? "单选" : "可多选"}
              {openTab === "knowledge" ? (
                <button type="button" className="btn compact" onClick={selectAllKnowledge}>
                  全部
                </button>
              ) : null}
            </span>
          </div>
          <div
            ref={listRef}
            className={`chat-context-banner-list${panning ? " is-panning" : ""}`}
          >
            {openTab === "skill" &&
              skillCatalog.map((item) => {
                const on = skills[item.id];
                const disabled = item.kind === "github" && !item.installed;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={on}
                    disabled={disabled}
                    className={`chat-context-option${on ? " active" : ""}${disabled ? " disabled" : ""}`}
                    onClick={() => toggleSkill(item.id)}
                  >
                    <span className="chat-context-option-name">{item.name}</span>
                    <span className="chat-context-option-desc">{item.desc}</span>
                  </button>
                );
              })}
            {openTab === "mcp" &&
              mcpCatalog.map((item) => {
                const on = mcps[item.id];
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={on}
                    className={`chat-context-option${on ? " active" : ""}`}
                    onClick={() => toggleMcp(item.id)}
                  >
                    <span className="chat-context-option-name">{item.name}</span>
                    <span className="chat-context-option-desc">{item.desc}</span>
                  </button>
                );
              })}
            {openTab === "permission" &&
              PERMISSION_PICKER_OPTIONS.map((item) => {
                const on = permission === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={on}
                    className={`chat-context-option${on ? " active" : ""}`}
                    onClick={() => selectPermission(item.id)}
                  >
                    <span className="chat-context-option-name">{item.label}</span>
                    <span className="chat-context-option-desc">{item.description}</span>
                  </button>
                );
              })}
            {openTab === "knowledge" &&
              knowledgeItems.map((item) => {
                const on = knowledgeEnabled[item.id];
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={on}
                    className={`chat-context-option${on ? " active" : ""}`}
                    onClick={() => toggleKnowledge(item.id)}
                  >
                    <span className="chat-context-option-name">{item.label}</span>
                    <span className="chat-context-option-desc">
                      {item.group === "scope" ? "知识范围" : "外部知识源"}
                    </span>
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
