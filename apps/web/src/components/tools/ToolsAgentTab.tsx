import { COACH_AGENTS } from "../../lib/coach-context";

type Props = {
  agentRole: string;
  onChange: (value: string) => void;
};

export function ToolsAgentTab({ agentRole, onChange }: Props) {
  const applyTemplate = (template: string) => {
    onChange(template);
  };

  return (
    <>
      <p className="settings-hint tools-tab-lead">
        定义工头助手的角色与行为准则；保存时同步为默认约束（defaultConstraints）。
      </p>

      <div className="tools-section">
        <h4 className="tools-section-title">角色模板</h4>
        <div className="tools-agent-templates">
          {COACH_AGENTS.map((agent) => (
            <button
              key={agent.id}
              type="button"
              className="tools-agent-template"
              onClick={() =>
                applyTemplate(
                  agent.id === "coach"
                    ? "你是 OpenX 工头助手，负责拆解目标、跟踪进展、协调 Pi 在本机执行。"
                    : agent.id === "pi"
                      ? "你是 Pi 执行助手，专注在本机工作目录完成代码与命令类任务，输出可验收结果。"
                      : "你是 OpenX 审查员，对照验收标准检查产出，指出差距并给出可执行修改建议。",
                )
              }
            >
              <strong>{agent.name}</strong>
              <span>{agent.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="tools-section">
        <h4 className="tools-section-title">Agent 设计</h4>
        <textarea
          className="mech-textarea tools-agent-textarea"
          value={agentRole}
          onChange={(e) => onChange(e.target.value)}
          rows={8}
          placeholder="描述 Agent 角色、语气、边界…"
        />
      </div>
    </>
  );
}
