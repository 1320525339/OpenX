import { useCallback, useEffect, useState } from "react";
import {
  api,
  type ManagedAgentInfo,
  type SkillBinding,
  type WorkspaceSkillsLink,
} from "../api";
import {
  COACH_SKILLS,
  catalogToCoachSkills,
  type CoachSkill,
} from "./coach-context";

export function useSkillCatalog() {
  const [skills, setSkills] = useState<CoachSkill[]>(COACH_SKILLS);
  const [bindings, setBindings] = useState<Record<string, SkillBinding>>({});
  const [skillsDir, setSkillsDir] = useState<string | undefined>();
  const [workspaceLink, setWorkspaceLink] = useState<WorkspaceSkillsLink | undefined>();
  const [agents, setAgents] = useState<ManagedAgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const applySkillsResponse = useCallback(
    (res: Awaited<ReturnType<typeof api.getSkills>>) => {
      setSkills(catalogToCoachSkills(res.skills));
      setBindings(res.bindings);
      setSkillsDir(res.skillsDir);
      setWorkspaceLink(res.workspaceLink);
      setAgents(res.agents);
    },
    [],
  );

  const refreshManagedAgents = useCallback(async () => {
    try {
      const { agents: online } = await api.getManagedAgents();
      setAgents(online);
    } catch {
      /* 保留注册表快照，在线状态可稍后重试 */
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const res = await api.getSkills();
      applySkillsResponse(res);
      void refreshManagedAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [applySkillsResponse, refreshManagedAgents]);

  const syncSkills = useCallback(async () => {
    setSyncing(true);
    setError(undefined);
    try {
      await api.syncSkills();
      const current = await api.getSkills();
      applySkillsResponse(current);
      void refreshManagedAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setSyncing(false);
    }
  }, [applySkillsResponse, refreshManagedAgents]);

  const saveBindings = useCallback(async (next: Record<string, SkillBinding>) => {
    const res = await api.putSkillBindings(next);
    setBindings(res.bindings);
    return res;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    skills,
    bindings,
    skillsDir,
    workspaceLink,
    agents,
    loading,
    syncing,
    error,
    refresh,
    refreshManagedAgents,
    syncSkills,
    saveBindings,
    setBindings,
  };
}
