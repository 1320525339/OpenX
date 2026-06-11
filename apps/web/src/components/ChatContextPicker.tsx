import { useEffect, useRef, useState } from "react";
import { useMcpCatalog } from "../lib/use-mcp-catalog";
import {
  COACH_AGENTS,
  COACH_SKILLS,
  countEnabled,
  loadAgentSelection,
  loadMcpSelection,
  loadSkillSelection,
  saveAgentSelection,
  saveMcpSelection,
  saveSkillSelection,
  type CoachAgent,
  type CoachSkill,
} from "../lib/coach-context";

export type PickerTab = "skill" | "mcp" | "agent";

type Props = {
  skillCatalog?: CoachSkill[];
  agentCatalog?: CoachAgent[];
  onContextChange?: (ctx: {
    skills: Record<string, boolean>;
    mcps: Record<string, boolean>;
    agentId: string;
  }) => void;
};

export function ChatContextPicker({
  skillCatalog = COACH_SKILLS,
  agentCatalog = COACH_AGENTS,
  onContextChange,
}: Props) {
  const { mcps: mcpCatalog } = useMcpCatalog();
  const [openTab, setOpenTab] = useState<PickerTab | null>(null);
  const [skills, setSkills] = useState(() => loadSkillSelection(skillCatalog));
  const [mcps, setMcps] = useState(loadMcpSelection);
  const [agentId, setAgentId] = useState(() => loadAgentSelection(agentCatalog));

  useEffect(() => {
    setSkills(loadSkillSelection(skillCatalog));
  }, [skillCatalog.map((s) => `${s.id}:${s.installed}`).join("|")]);

  useEffect(() => {
    setAgentId((prev) => {
      if (agentCatalog.some((a) => a.id === prev)) return prev;
      const next = loadAgentSelection(agentCatalog);
      saveAgentSelection(next);
      return next;
    });
  }, [agentCatalog.map((a) => a.id).join("|")]);

  const footerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [panning, setPanning] = useState(false);

  const onContextChangeRef = useRef(onContextChange);
  onContextChangeRef.current = onContextChange;

  useEffect(() => {
    onContextChangeRef.current?.({ skills, mcps, agentId });
  }, [skills, mcps, agentId]);

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

  const selectAgent = (id: string) => {
    setAgentId(id);
    saveAgentSelection(id);
    setOpenTab(null);
  };

  const skillCount = countEnabled(skills);
  const mcpCount = countEnabled(mcps);
  const activeAgent = agentCatalog.find((a) => a.id === agentId) ?? agentCatalog[0];

  return (
    <div className="chat-context-picker" ref={footerRef}>
      <div className="chat-context-tabs">
        <button
          type="button"
          className={`chat-context-tab${openTab === "skill" ? " open" : ""}`}
          aria-expanded={openTab === "skill"}
          onClick={() => toggleTab("skill")}
        >
          Skill{skillCount > 0 ? ` ${skillCount}` : ""}
        </button>
        <button
          type="button"
          className={`chat-context-tab${openTab === "mcp" ? " open" : ""}`}
          aria-expanded={openTab === "mcp"}
          onClick={() => toggleTab("mcp")}
        >
          MCP{mcpCount > 0 ? ` ${mcpCount}` : ""}
        </button>
        <button
          type="button"
          className={`chat-context-tab${openTab === "agent" ? " open" : ""}`}
          aria-expanded={openTab === "agent"}
          onClick={() => toggleTab("agent")}
        >
          Agent
          <span className="chat-context-tab-label">{activeAgent?.name ?? "Agent"}</span>
        </button>
      </div>

      {openTab && (
        <div className="chat-context-banner" role="listbox" aria-label="上下文选择">
          <div className="chat-context-banner-head">
            <span className="chat-context-banner-title">
              {openTab === "skill" && "选择 Skills"}
              {openTab === "mcp" && "选择 MCP"}
              {openTab === "agent" && "选择 Agent"}
            </span>
            <span className="chat-context-banner-hint">
              {openTab === "agent" ? "单选" : "可多选"}
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
            {openTab === "agent" &&
              agentCatalog.map((item) => {
                const on = agentId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={on}
                    className={`chat-context-option${on ? " active" : ""}`}
                    onClick={() => selectAgent(item.id)}
                  >
                    <span className="chat-context-option-name">{item.name}</span>
                    <span className="chat-context-option-desc">{item.desc}</span>
                  </button>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
