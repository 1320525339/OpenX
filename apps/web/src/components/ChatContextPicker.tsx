import { useEffect, useRef, useState } from "react";
import {
  COACH_AGENTS,
  COACH_MCPS,
  COACH_SKILLS,
  countEnabled,
  loadAgentSelection,
  loadMcpSelection,
  loadSkillSelection,
  saveAgentSelection,
  saveMcpSelection,
  saveSkillSelection,
  type CoachSkill,
} from "../lib/coach-context";

export type PickerTab = "skill" | "mcp" | "agent";

type Props = {
  skillCatalog?: CoachSkill[];
  onContextChange?: (ctx: {
    skills: Record<string, boolean>;
    mcps: Record<string, boolean>;
    agentId: string;
  }) => void;
};

export function ChatContextPicker({ skillCatalog = COACH_SKILLS, onContextChange }: Props) {
  const [openTab, setOpenTab] = useState<PickerTab | null>(null);
  const [skills, setSkills] = useState(() => loadSkillSelection(skillCatalog));
  const [mcps, setMcps] = useState(loadMcpSelection);
  const [agentId, setAgentId] = useState(loadAgentSelection);
  const footerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSkills(loadSkillSelection(skillCatalog));
  }, [skillCatalog.map((s) => `${s.id}:${s.installed}`).join("|")]);

  const onContextChangeRef = useRef(onContextChange);
  onContextChangeRef.current = onContextChange;

  useEffect(() => {
    onContextChangeRef.current?.({ skills, mcps, agentId });
  }, [skills, mcps, agentId]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!footerRef.current?.contains(e.target as Node)) {
        setOpenTab(null);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

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
  const activeAgent = COACH_AGENTS.find((a) => a.id === agentId) ?? COACH_AGENTS[0];

  return (
    <div className="chat-context-picker" ref={footerRef}>
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
          <div className="chat-context-banner-list">
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
              COACH_MCPS.map((item) => {
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
              COACH_AGENTS.map((item) => {
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

      <div className="chat-context-tabs">
        <button
          type="button"
          className={`chat-context-tab${openTab === "skill" ? " open" : ""}`}
          aria-expanded={openTab === "skill"}
          onClick={() => toggleTab("skill")}
        >
          Skill
          {skillCount > 0 && <span className="chat-context-tab-badge">{skillCount}</span>}
        </button>
        <button
          type="button"
          className={`chat-context-tab${openTab === "mcp" ? " open" : ""}`}
          aria-expanded={openTab === "mcp"}
          onClick={() => toggleTab("mcp")}
        >
          MCP
          {mcpCount > 0 && <span className="chat-context-tab-badge">{mcpCount}</span>}
        </button>
        <button
          type="button"
          className={`chat-context-tab${openTab === "agent" ? " open" : ""}`}
          aria-expanded={openTab === "agent"}
          onClick={() => toggleTab("agent")}
        >
          Agent
          <span className="chat-context-tab-label">{activeAgent.name}</span>
        </button>
      </div>
    </div>
  );
}
