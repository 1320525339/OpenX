import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_PI_MAX_TOOL_CALLS, type Goal, type Settings } from "@openx/shared";
import type { ExecutorInfo, SkillBinding } from "../api";
import { loadSkillBindings, saveSkillBindings } from "../lib/coach-context";
import { useSkillCatalog } from "../lib/use-skill-catalog";
import { listManagedClis } from "../lib/tools-clis";
import { api } from "../api";
import { ToolsCliTab } from "./tools/ToolsCliTab";
import { ToolsSkillsTab } from "./tools/ToolsSkillsTab";
import { ToolsAgentTab, formatAgentMd } from "./tools/ToolsAgentTab";
import { ToolsMcpTab } from "./tools/ToolsMcpTab";
import { ToolsExtensionsCenter } from "./tools/ToolsExtensionsCenter";

type ToolsTab = "cli" | "skills" | "agent" | "mcp" | "extensions";

type Props = {
  settings: Settings;
  executors: ExecutorInfo[];
  onChange: (settings: Settings) => void;
  onSave: (settings: Settings) => Promise<void>;
  onRefreshExecutors: () => Promise<void>;
  onIntegrationGoalCreated: (goal: Goal) => void;
  onConnectReady?: (executorId: string) => void;
};

const TAB_KEY = "openx.tools.activeTab";
const AGENT_ROLE_KEY = "openx.tools.agentRole";

type ToolsSnapshot = {
  defaultExecutorId: string;
  autoExecute: boolean;
  skillBindings: Record<string, SkillBinding>;
  globalConstraints: string;
  personaId: string;
  personaBody: string;
  piRunTimeoutMs: number;
  piMaxToolCalls: number;
  autoBootstrapConnect: boolean;
};

function snapshotToolsState(
  settings: Settings,
  bindings: Record<string, SkillBinding>,
  globalConstraints: string,
  personaId: string,
  personaBody: string,
): ToolsSnapshot {
  return {
    defaultExecutorId: settings.defaultExecutorId,
    autoExecute: settings.autoExecute,
    skillBindings: bindings,
    globalConstraints,
    personaId,
    personaBody,
    piRunTimeoutMs: settings.executors.pi.runTimeoutMs ?? 600_000,
    piMaxToolCalls: settings.executors.pi.maxToolCalls ?? DEFAULT_PI_MAX_TOOL_CALLS,
    autoBootstrapConnect: settings.autoBootstrapConnect ?? true,
  };
}

function toolsSnapshotEqual(a: ToolsSnapshot, b: ToolsSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function loadTab(): ToolsTab {
  const v = localStorage.getItem(TAB_KEY);
  if (v === "miloco") return "extensions";
  if (v === "cli" || v === "skills" || v === "agent" || v === "mcp" || v === "extensions") {
    return v;
  }
  return "cli";
}

export function ToolsPanel({
  settings,
  executors,
  onChange,
  onSave,
  onRefreshExecutors,
  onIntegrationGoalCreated,
  onConnectReady,
}: Props) {
  const [tab, setTab] = useState<ToolsTab>(loadTab);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [globalConstraints, setGlobalConstraints] = useState(() =>
    (localStorage.getItem(AGENT_ROLE_KEY) ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join("\n"),
  );
  const [personaId, setPersonaId] = useState("coach");
  const [personaBody, setPersonaBody] = useState("");
  const [personaMeta, setPersonaMeta] = useState({ name: "", desc: "" });
  const [savedSnapshot, setSavedSnapshot] = useState<ToolsSnapshot | null>(null);
  const snapshotReadyRef = useRef(false);
  const migratedRef = useRef(false);

  const {
    skills: catalogSkills,
    bindings: serverBindings,
    skillsDir,
    workspaceLink,
    agents,
    loading: skillsLoading,
    syncing: skillsSyncing,
    error: skillsError,
    syncSkills,
    saveBindings,
    setBindings,
  } = useSkillCatalog();

  const cliIds = useMemo(
    () => listManagedClis(executors, settings.cliProfiles ?? []).map((c) => c.id),
    [executors, settings.cliProfiles],
  );

  useEffect(() => {
    if (skillsLoading || snapshotReadyRef.current) return;
    snapshotReadyRef.current = true;
    setSavedSnapshot(
      snapshotToolsState(
        settings,
        serverBindings,
        globalConstraints,
        personaId,
        personaBody,
      ),
    );
  }, [globalConstraints, personaBody, personaId, serverBindings, settings, skillsLoading]);

  const currentSnapshot = useMemo(
    () =>
      snapshotToolsState(
        settings,
        serverBindings,
        globalConstraints,
        personaId,
        personaBody,
      ),
    [globalConstraints, personaBody, personaId, serverBindings, settings],
  );
  const dirty =
    savedSnapshot !== null && !toolsSnapshotEqual(currentSnapshot, savedSnapshot);
  useEffect(() => {
    setBindings(serverBindings);
  }, [serverBindings, setBindings]);

  useEffect(() => {
    if (migratedRef.current || skillsLoading) return;
    if (Object.keys(settings.skillBindings ?? {}).length > 0) {
      migratedRef.current = true;
      return;
    }
    const legacy = loadSkillBindings(cliIds, catalogSkills);
    const hasLegacy = Object.values(legacy).some((b) => b.enabled);
    if (!hasLegacy) {
      migratedRef.current = true;
      return;
    }
    migratedRef.current = true;
    void saveBindings(legacy).then((res) => {
      onChange(res.settings);
      setSavedSnapshot(
        snapshotToolsState(
          res.settings,
          res.bindings,
          globalConstraints,
          personaId,
          personaBody,
        ),
      );
    });
  }, [
    globalConstraints,
    personaBody,
    personaId,
    catalogSkills,
    cliIds,
    onChange,
    saveBindings,
    settings.skillBindings,
    skillsLoading,
  ]);

  const selectTab = (next: ToolsTab) => {
    setTab(next);
    localStorage.setItem(TAB_KEY, next);
  };

  const refreshClis = async () => {
    setDetecting(true);
    try {
      await onRefreshExecutors();
    } finally {
      setDetecting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      localStorage.setItem(AGENT_ROLE_KEY, globalConstraints);
      saveSkillBindings(serverBindings, catalogSkills);
      const bindRes = await saveBindings(serverBindings);
      onChange(bindRes.settings);
      const constraints = globalConstraints
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 8);
      const nextSettings = {
        ...bindRes.settings,
        defaultExecutorId: settings.defaultExecutorId,
        autoExecute: settings.autoExecute,
        executors: settings.executors,
        defaultConstraints:
          constraints.length > 0 ? constraints : bindRes.settings.defaultConstraints,
      };
      await api.putAgent(
        personaId,
        formatAgentMd(personaMeta.name || personaId, personaMeta.desc, personaBody),
      );
      await onSave(nextSettings);
      setSavedSnapshot(
        snapshotToolsState(
          nextSettings,
          bindRes.bindings,
          globalConstraints,
          personaId,
          personaBody,
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  const enabledSkillCount = Object.values(serverBindings).filter((b) => b.enabled).length;
  const isIntegrationTab = tab === "extensions";

  const coreTabs: Array<[string, string, number?]> = [
    ["cli", "CLI"],
    ["skills", "Skills", enabledSkillCount],
    ["mcp", "MCP"],
    ["extensions", "拓展中心"],
    ["agent", "Agent"],
  ];

  return (
    <section className="mech-panel page-panel">
      <div className="mech-panel-head page-panel-head">
        <div className="tools-tabs" role="tablist">
          {coreTabs.map(([id, label, badge]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`tools-tab${tab === id ? " active" : ""}`}
              onClick={() => selectTab(id as ToolsTab)}
            >
              {label}
              {typeof badge === "number" && badge > 0 && (
                <span className="tools-tab-badge">{badge}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="mech-panel-body panel-stack">
        <div className="panel-scroll tools-scroll">
          {tab === "cli" && (
            <ToolsCliTab
              settings={settings}
              executors={executors}
              detecting={detecting}
              onChange={onChange}
              onRefresh={() => void refreshClis()}
              onIntegrationGoalCreated={onIntegrationGoalCreated}
              onDeleteProfile={async (executorId) => {
                const res = await api.deleteCliProfile(executorId);
                onChange(res.settings);
                await onRefreshExecutors();
              }}
              onBootstrap={async (executorId) => {
                const res = await api.bootstrapCli(executorId, { wait: true });
                await onRefreshExecutors();
                return res;
              }}
              onConnectReady={onConnectReady}
              onDisconnect={async (executorId) => {
                await api.disconnectCli(executorId);
                await onRefreshExecutors();
              }}
            />
          )}
          {tab === "skills" && (
            <ToolsSkillsTab
              skills={catalogSkills}
              skillsDir={skillsDir}
              workspaceLink={workspaceLink}
              agents={agents}
              skillsLoading={skillsLoading}
              skillsSyncing={skillsSyncing}
              skillsError={skillsError}
              onSyncSkills={syncSkills}
              executors={executors}
              cliProfiles={settings.cliProfiles ?? []}
              bindings={serverBindings}
              onChange={setBindings}
            />
          )}
          {tab === "agent" && (
            <ToolsAgentTab
              personaId={personaId}
              onPersonaIdChange={setPersonaId}
              personaBody={personaBody}
              onPersonaBodyChange={setPersonaBody}
              personaName={personaMeta.name}
              personaDesc={personaMeta.desc}
              onPersonaMetaChange={setPersonaMeta}
              globalConstraints={globalConstraints}
              onGlobalConstraintsChange={setGlobalConstraints}
            />
          )}
          {tab === "mcp" && (
            <ToolsMcpTab
              servers={settings.mcpServers ?? []}
              onSaved={(servers) => onChange({ ...settings, mcpServers: servers })}
            />
          )}
          {tab === "extensions" && (
            <ToolsExtensionsCenter
              onOpenGoal={(goal) => onIntegrationGoalCreated(goal)}
            />
          )}
        </div>

        {!isIntegrationTab ? (
        <div className="panel-footer settings-panel-footer">
          <span className="settings-footer-status" aria-live="polite">
            {dirty && <span className="settings-dirty">有未保存的更改</span>}
          </span>
          <button
            type="button"
            className="btn primary"
            disabled={saving || !dirty}
            onClick={() => void save()}
          >
            {saving ? "保存中…" : "保存工具配置"}
          </button>
        </div>
        ) : null}
      </div>
    </section>
  );
}
