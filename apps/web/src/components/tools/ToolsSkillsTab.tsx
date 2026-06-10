import {
  type CoachSkill,
  type SkillBinding,
} from "../../lib/coach-context";
import { cliShortLabel, listInstalledClis } from "../../lib/tools-clis";
import type { ManagedAgentInfo, WorkspaceSkillsLink } from "../../api";
import type { CliProfile } from "@openx/shared";
import type { ExecutorInfo } from "../../api";

type Props = {
  skills: CoachSkill[];
  skillsDir?: string;
  workspaceLink?: WorkspaceSkillsLink;
  agents?: ManagedAgentInfo[];
  skillsLoading?: boolean;
  skillsSyncing?: boolean;
  skillsError?: string;
  onSyncSkills?: () => Promise<void>;
  executors: ExecutorInfo[];
  cliProfiles: CliProfile[];
  bindings: Record<string, SkillBinding>;
  onChange: (next: Record<string, SkillBinding>) => void;
};

function agentById(agents: ManagedAgentInfo[], id: string): ManagedAgentInfo | undefined {
  return agents.find((a) => a.executorId === id);
}

export function ToolsSkillsTab({
  skills,
  skillsDir,
  workspaceLink,
  agents = [],
  skillsLoading,
  skillsSyncing,
  skillsError,
  onSyncSkills,
  executors,
  cliProfiles,
  bindings,
  onChange,
}: Props) {
  const clis = listInstalledClis(executors, cliProfiles);
  const cliIds = clis.map((c) => c.id);
  const onlineCount = agents.filter((a) => a.available).length;

  const patchSkill = (skillId: string, patch: Partial<SkillBinding>) => {
    const prev = bindings[skillId] ?? { enabled: false, cliIds: [] };
    onChange({
      ...bindings,
      [skillId]: { ...prev, ...patch },
    });
  };

  const toggleEnabled = (skillId: string) => {
    const prev = bindings[skillId] ?? { enabled: false, cliIds: [] };
    const enabled = !prev.enabled;
    patchSkill(skillId, {
      enabled,
      cliIds:
        enabled && prev.cliIds.length === 0
          ? cliIds.includes("pi")
            ? ["pi"]
            : cliIds.slice(0, 1)
          : prev.cliIds,
    });
  };

  const toggleCli = (skillId: string, cliId: string) => {
    const prev = bindings[skillId] ?? { enabled: false, cliIds: [] };
    const has = prev.cliIds.includes(cliId);
    const cliIdsNext = has ? prev.cliIds.filter((id) => id !== cliId) : [...prev.cliIds, cliId];
    patchSkill(skillId, {
      enabled: cliIdsNext.length > 0 ? true : prev.enabled,
      cliIds: cliIdsNext,
    });
  };

  const assignAllClis = (skillId: string) => {
    patchSkill(skillId, { enabled: true, cliIds: [...cliIds] });
  };

  const githubSkills = skills.filter((s) => s.kind === "github");
  const missingRequired = githubSkills.filter((s) => s.required && !s.installed);

  const chipClass = (_skillId: string, cliId: string, binding: SkillBinding) => {
    const on = binding.cliIds.includes(cliId);
    const agent = agentById(agents, cliId);
    const classes = ["tools-cli-chip"];
    if (on) classes.push("on");
    if (on && agent?.available) classes.push("online");
    if (on && agent && !agent.available) classes.push("offline-assigned");
    if (!binding.enabled && !on) classes.push("dim");
    return classes.join(" ");
  };

  return (
    <>
      <p className="settings-hint tools-tab-lead">
        系统内置 Skills 从 GitHub 拉取 Obscura；全局目录{" "}
        <code>{skillsDir ?? "~/.openx/skills"}</code>，Pi / Connect 执行时加载。
      </p>

      <div className="tools-skill-summary">
        <span>
          Agent：<strong>{onlineCount}</strong> 在线 / {agents.length || cliIds.length} 已配置
        </span>
        {workspaceLink && (
          <span className={workspaceLink.linked ? "tools-link-ok" : "tools-link-warn"}>
            工作区链接：
            {workspaceLink.linked
              ? `已链接 ${workspaceLink.linkPath}`
              : workspaceLink.error ?? "未链接"}
          </span>
        )}
      </div>

      <div className="tools-skill-toolbar">
        <button
          type="button"
          className="btn secondary compact"
          disabled={skillsSyncing || skillsLoading}
          onClick={() => void onSyncSkills?.()}
        >
          {skillsSyncing ? "同步中…" : "从 GitHub 同步 Obscura"}
        </button>
        {skillsLoading && <span className="settings-hint">加载 Skills…</span>}
        {skillsError && <span className="settings-hint error">{skillsError}</span>}
        {missingRequired.length > 0 && (
          <span className="settings-hint error">
            {missingRequired.length} 个必需 Skill 未安装，请点击同步
          </span>
        )}
      </div>

      {cliIds.length === 0 && (
        <p className="settings-hint">
          请先在 CLI 页添加或检测已安装的执行器，再分配 Skills。
        </p>
      )}

      {cliIds.length >= 3 && agents.length > 0 && (
        <details className="tools-skill-matrix">
          <summary>Skill × Agent 分配矩阵</summary>
          <table className="tools-skill-matrix-table">
            <thead>
              <tr>
                <th>Skill</th>
                {agents.map((a) => (
                  <th key={a.executorId} title={a.hint}>
                    {cliShortLabel(a.executorId)}
                    {a.available ? " ●" : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {skills.map((skill) => {
                const binding = bindings[skill.id] ?? { enabled: false, cliIds: [] };
                return (
                  <tr key={skill.id}>
                    <td>{skill.name}</td>
                    {agents.map((a) => {
                      const assigned = binding.enabled && binding.cliIds.includes(a.executorId);
                      return (
                        <td
                          key={a.executorId}
                          className={
                            assigned
                              ? a.available
                                ? "matrix-on"
                                : "matrix-offline"
                              : "matrix-off"
                          }
                        >
                          {assigned ? "✓" : "—"}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
      )}

      <div className="tools-skill-list">
        {skills.map((skill) => {
          const binding = bindings[skill.id] ?? { enabled: false, cliIds: [] };
          const notInstalled = skill.kind === "github" && !skill.installed;
          return (
            <div
              key={skill.id}
              className={`tools-skill-row${binding.enabled ? " enabled" : ""}${notInstalled ? " missing" : ""}`}
            >
              <div className="tools-skill-row-head">
                <label className="tools-skill-enable">
                  <input
                    type="checkbox"
                    checked={binding.enabled}
                    disabled={notInstalled}
                    onChange={() => toggleEnabled(skill.id)}
                  />
                  <span className="tools-skill-enable-body">
                    <span className="tools-skill-title-row">
                      <strong className="tools-skill-name">{skill.name}</strong>
                      <span className="tools-skill-tags">
                        {skill.required && (
                          <span className="tools-skill-badge required">必需</span>
                        )}
                        {skill.kind === "github" && (
                          <span className="tools-skill-badge subtle">Obscura</span>
                        )}
                      </span>
                    </span>
                    <span className="tools-skill-desc">{skill.desc}</span>
                    {skill.installError && (
                      <span className="settings-hint error tools-skill-error">
                        {skill.installError}
                      </span>
                    )}
                  </span>
                </label>
                <button
                  type="button"
                  className="btn linkish compact tools-skill-assign-all"
                  disabled={cliIds.length === 0 || notInstalled}
                  onClick={() => assignAllClis(skill.id)}
                >
                  分配给全部 CLI
                </button>
              </div>

              <div className="tools-skill-cli-picks">
                <span className="tools-skill-cli-label">可调用 CLI</span>
                <div className="tools-skill-cli-chips">
                  {cliIds.length === 0 ? (
                    <span className="settings-hint">—</span>
                  ) : (
                    clis.map((cli) => {
                      const on = binding.cliIds.includes(cli.id);
                      const agent = agentById(agents, cli.id);
                      return (
                        <button
                          key={cli.id}
                          type="button"
                          className={chipClass(skill.id, cli.id, binding)}
                          disabled={(!binding.enabled && !on) || notInstalled}
                          title={
                            agent
                              ? `${agent.hint ?? ""}${on && !agent.available ? " · 已分配但离线" : ""}`
                              : cli.hint
                          }
                          onClick={() => toggleCli(skill.id, cli.id)}
                        >
                          {cliShortLabel(cli.id)}
                          {on && agent?.available && <span className="tools-cli-dot" />}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
