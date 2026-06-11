import { useEffect, useState } from "react";
import { api } from "../api";
import {
  COACH_AGENTS,
  catalogToCoachAgents,
  type CoachAgent,
} from "./coach-context";

/** 对话 Agent 目录：本地 fallback 立即可用，后台拉 /api/agents 刷新（不阻塞 detectExecutors） */
export function useAgentCatalog() {
  const [agents, setAgents] = useState<CoachAgent[]>(COACH_AGENTS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void api
      .getAgents()
      .then(({ coachAgents }) => {
        if (cancelled) return;
        if (coachAgents?.length) {
          setAgents(catalogToCoachAgents(coachAgents));
        }
      })
      .catch(() => {
        if (!cancelled) setAgents(COACH_AGENTS);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { agents, loading };
}
