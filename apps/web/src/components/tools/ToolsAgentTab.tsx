import { useEffect } from "react";
import { api } from "../../api";
import { useAgentCatalog } from "../../lib/use-agent-catalog";

type Props = {
  personaId: string;
  onPersonaIdChange: (id: string) => void;
  personaBody: string;
  onPersonaBodyChange: (value: string) => void;
  personaName: string;
  personaDesc: string;
  onPersonaMetaChange: (meta: { name: string; desc: string }) => void;
  globalConstraints: string;
  onGlobalConstraintsChange: (value: string) => void;
};

export function formatAgentMd(name: string, desc: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${desc}\n---\n\n${body.trim()}\n`;
}

export function ToolsAgentTab({
  personaId,
  onPersonaIdChange,
  personaBody,
  onPersonaBodyChange,
  personaName,
  personaDesc,
  onPersonaMetaChange,
  globalConstraints,
  onGlobalConstraintsChange,
}: Props) {
  const { agents } = useAgentCatalog();

  useEffect(() => {
    let cancelled = false;
    void api
      .getAgent(personaId)
      .then((doc) => {
        if (cancelled) return;
        onPersonaMetaChange({ name: doc.name, desc: doc.desc });
        onPersonaBodyChange(doc.body);
      })
      .catch(() => {
        if (!cancelled) onPersonaBodyChange("");
      });
    return () => {
      cancelled = true;
    };
  }, [personaId]);

  const applyTemplate = (id: string) => {
    onPersonaIdChange(id);
  };

  return (
    <>
      <p className="settings-hint tools-tab-lead">
        Coach Persona 保存在 <code>~/.openx/agents/&lt;id&gt;/AGENT.md</code>；「全局约束」附加到每次派单 prompt。
      </p>

      <div className="tools-section">
        <h4 className="tools-section-title">Persona 模板</h4>
        <div className="tools-agent-templates">
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              className={`tools-agent-template${personaId === agent.id ? " active" : ""}`}
              onClick={() => applyTemplate(agent.id)}
            >
              <strong>{agent.name}</strong>
              <span>{agent.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="tools-section">
        <h4 className="tools-section-title">Persona 正文（AGENT.md）</h4>
        <select
          className="field-input tools-agent-persona-select"
          value={personaId}
          onChange={(e) => onPersonaIdChange(e.target.value)}
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <textarea
          className="mech-textarea tools-agent-textarea"
          value={personaBody}
          onChange={(e) => onPersonaBodyChange(e.target.value)}
          rows={8}
          placeholder="编辑选中 Persona 的角色说明…"
        />
        <p className="settings-hint">
          保存时将写入 <code>{personaId}/AGENT.md</code>
          {personaName ? `（${personaName}）` : ""}
          {personaDesc ? ` · ${personaDesc}` : ""}
        </p>
      </div>

      <div className="tools-section">
        <h4 className="tools-section-title">全局约束</h4>
        <textarea
          className="mech-textarea tools-agent-textarea"
          value={globalConstraints}
          onChange={(e) => onGlobalConstraintsChange(e.target.value)}
          rows={4}
          placeholder="每行一条，写入 settings.defaultConstraints"
        />
      </div>
    </>
  );
}
