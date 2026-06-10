import { useEffect, useMemo, useRef, useState } from "react";
import type { Goal, Settings } from "@openx/shared";
import type { ExecutorInfo, SkillBinding } from "../api";
import { loadSkillBindings, saveSkillBindings } from "../lib/coach-context";
import { useSkillCatalog } from "../lib/use-skill-catalog";
import { listManagedClis } from "../lib/tools-clis";
import { api } from "../api";
import { ToolsCliTab } from "./tools/ToolsCliTab";
import { ToolsSkillsTab } from "./tools/ToolsSkillsTab";
import { ToolsAgentTab } from "./tools/ToolsAgentTab";

type ToolsTab = "cli" | "skills" | "agent";

type Props = {
  settings: Settings;
  executors: ExecutorInfo[];
  onChange: (settings: Settings) => void;
  onSave: (settings: Settings) => Promise<void>;
  onRefreshExecutors: () => Promise<void>;
  onIntegrationGoalCreated: (goal: Goal) => void;
};

const TAB_KEY = "openx.tools.activeTab";
const AGENT_ROLE_KEY = "openx.tools.agentRole";

type ToolsSnapshot = {
  defaultExecutorId: string;
  autoExecute: boolean;
  skillBindings: Record<string, SkillBinding>;
  agentRole: string;
};

function snapshotToolsState(
  settings: Settings,
  bindings: Record<string, SkillBinding>,
  agentRole: string,
): ToolsSnapshot {
  return {
    defaultExecutorId: settings.defaultExecutorId,
    autoExecute: settings.autoExecute,
    skillBindings: bindings,
    agentRole,
  };
}

function toolsSnapshotEqual(a: ToolsSnapshot, b: ToolsSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function loadTab(): ToolsTab {
  const v = localStorage.getItem(TAB_KEY);
  if (v === "cli" || v === "skills" || v === "agent") return v;
  return "cli";
}

export function ToolsPanel({
  settings,
  executors,
  onChange,
  onSave,
  onRefreshExecutors,
  onIntegrationGoalCreated,
}: Props) {
  const [tab, setTab] = useState<ToolsTab>(loadTab);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [agentRole, setAgentRole] = useState(
    () =>
      localStorage.getItem(AGENT_ROLE_KEY) ??
      "你是 OpenX 工头助手，负责拆解目标、跟踪进展、协调 Pi 在本机执行。",
  );
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
    setSavedSnapshot(snapshotToolsState(settings, serverBindings, agentRole));
  }, [agentRole, serverBindings, settings, skillsLoading]);

  const currentSnapshot = useMemo(
    () => snapshotToolsState(settings, serverBindings, agentRole),
    [agentRole, serverBindings, settings],
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
      setSavedSnapshot(snapshotToolsState(res.settings, res.bindings, agentRole));
    });
  }, [
    agentRole,
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
      localStorage.setItem(AGENT_ROLE_KEY, agentRole);
      saveSkillBindings(serverBindings, catalogSkills);
      const bindRes = await saveBindings(serverBindings);
      onChange(bindRes.settings);
      const constraints = agentRole
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 8);
      const nextSettings = {
        ...bindRes.settings,
        defaultConstraints:
          constraints.length > 0 ? constraints : bindRes.settings.defaultConstraints,
      };
      await onSave(nextSettings);
      setSavedSnapshot(snapshotToolsState(nextSettings, bindRes.bindings, agentRole));
    } finally {
      setSaving(false);
    }
  };

  const enabledSkillCount = Object.values(serverBindings).filter((b) => b.enabled).length;

  return (
    <section className="mech-panel page-panel">
      <div className="mech-panel-head">
        <h3>工具</h3>
        <div className="tools-tabs" role="tablist">
          {(
            [
              ["cli", "CLI"],
              ["skills", "Skills", enabledSkillCount],
              ["agent", "Agent"],
            ] as const
          ).map(([id, label, badge]) => (
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
                const res = await api.bootstrapCli(executorId);
                setTimeout(() => void onRefreshExecutors(), 2500);
                return res;
              }}
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
            <ToolsAgentTab agentRole={agentRole} onChange={setAgentRole} />
          )}
        </div>

        <div className="panel-footer">
          <button
            type="button"
            className="btn primary"
            style={{ width: "100%" }}
            disabled={saving || !dirty}
            onClick={() => void save()}
          >
            {saving ? "保存中…" : "保存工具配置"}
          </button>
        </div>
      </div>
    </section>
  );
}
