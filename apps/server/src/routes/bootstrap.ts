import { Hono } from "hono";
import { getCoachRuntime } from "@openx/coach";
import { listProjects, listConversations } from "../db.js";
import { listAgentCatalog } from "../agents-service.js";
import { ensureSystemMainConversation } from "../system-workspace.js";
import { loadSettings } from "../settings-store.js";
import { withWorkspaceResolved } from "../workspace-path.js";

export const bootstrapRoutes = new Hono();

/** 应用启动快照：设置、项目树、系统调度台、Persona 目录（不触发 detectExecutors） */
bootstrapRoutes.get("/", (c) => {
  const settings = withWorkspaceResolved(loadSettings());
  const { project, conversation } = ensureSystemMainConversation();
  const runtime = getCoachRuntime(settings);

  return c.json({
    settings,
    projects: listProjects(),
    conversations: listConversations(),
    system: { project, conversation },
    coachAgents: listAgentCatalog(),
    coach: {
      ready: runtime.ready,
      slug: runtime.slug,
      model: runtime.model,
      baseUrl: runtime.baseUrl,
      error: runtime.error,
    },
  });
});
