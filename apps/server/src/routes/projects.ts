import { Hono } from "hono";
import { nanoid } from "nanoid";
import path from "node:path";
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  CreateConversationSchema,
  UpdateConversationSchema,
} from "@openx/shared";
import {
  listProjects,
  getProjectById,
  insertProject,
  updateProject,
  deleteProject,
  listConversations,
  getConversationById,
  insertConversation,
  updateConversation,
  deleteConversation,
} from "../db.js";
import { normalizeWorkspaceRootForStorage } from "../workspace-path.js";
import { ensureWorkspaceSkillsLink } from "../workspace-skills-link.js";
import {
  isSystemConversationId,
  isSystemProjectId,
} from "../system-workspace.js";
import { distillProjectMemory } from "../dream-job.js";
import { readProjectMemory } from "../memory-store.js";
import { resolveWorkspaceRoot } from "../workspace-path.js";

export const projectsRoutes = new Hono();

function defaultProjectName(workspaceDir: string): string {
  const normalized = normalizeWorkspaceRootForStorage(workspaceDir);
  return path.basename(normalized) || "未命名项目";
}

projectsRoutes.get("/", (c) => {
  const projects = listProjects();
  const conversations = listConversations();
  return c.json({ projects, conversations });
});

projectsRoutes.post("/", async (c) => {
  const input = CreateProjectSchema.parse(await c.req.json());
  const workspaceDir = normalizeWorkspaceRootForStorage(input.workspaceDir);
  const now = new Date().toISOString();
  const project = insertProject({
    id: nanoid(),
    name: input.name?.trim() || defaultProjectName(workspaceDir),
    workspaceDir,
    createdAt: now,
  });
  ensureWorkspaceSkillsLink(workspaceDir);
  return c.json({ project }, 201);
});

projectsRoutes.get("/:id", (c) => {
  const project = getProjectById(c.req.param("id"));
  if (!project) return c.json({ error: "Not found" }, 404);
  const conversations = listConversations(project.id);
  return c.json({ project, conversations });
});

projectsRoutes.patch("/:id", async (c) => {
  const project = getProjectById(c.req.param("id"));
  if (!project) return c.json({ error: "Not found" }, 404);
  const patch = UpdateProjectSchema.parse(await c.req.json());
  if (patch.name !== undefined) project.name = patch.name;
  if (patch.workspaceDir !== undefined) {
    project.workspaceDir = normalizeWorkspaceRootForStorage(patch.workspaceDir);
    ensureWorkspaceSkillsLink(project.workspaceDir);
  }
  if (patch.llmContext !== undefined) {
    project.llmContext = patch.llmContext;
  }
  updateProject(project);
  return c.json({ project });
});

projectsRoutes.delete("/:id", (c) => {
  const id = c.req.param("id");
  if (isSystemProjectId(id)) {
    return c.json({ error: "系统项目不可删除" }, 403);
  }
  const ok = deleteProject(id);
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

projectsRoutes.get("/:id/memory", (c) => {
  const project = getProjectById(c.req.param("id"));
  if (!project) return c.json({ error: "Not found" }, 404);
  const workspaceRoot = resolveWorkspaceRoot(project.workspaceDir);
  const memory = readProjectMemory(workspaceRoot, project.id);
  return c.json({ projectId: project.id, memory: memory ?? "" });
});

projectsRoutes.post("/:id/memory/distill", (c) => {
  const result = distillProjectMemory(c.req.param("id"));
  if (!result.ok && result.detail === "项目不存在") {
    return c.json({ error: result.detail }, 404);
  }
  return c.json(result);
});

projectsRoutes.post("/:id/conversations", async (c) => {
  const project = getProjectById(c.req.param("id"));
  if (!project) return c.json({ error: "Not found" }, 404);
  const input = CreateConversationSchema.parse(await c.req.json().catch(() => ({})));
  const now = new Date().toISOString();
  const conversation = insertConversation({
    id: nanoid(),
    projectId: project.id,
    title: input.title?.trim() || "新对话",
    createdAt: now,
    updatedAt: now,
  });
  return c.json({ conversation }, 201);
});

export const conversationsRoutes = new Hono();

conversationsRoutes.get("/:id", (c) => {
  const conversation = getConversationById(c.req.param("id"));
  if (!conversation) return c.json({ error: "Not found" }, 404);
  const project = getProjectById(conversation.projectId);
  return c.json({ conversation, project });
});

conversationsRoutes.patch("/:id", async (c) => {
  const conversation = getConversationById(c.req.param("id"));
  if (!conversation) return c.json({ error: "Not found" }, 404);
  const patch = UpdateConversationSchema.parse(await c.req.json());
  conversation.title = patch.title;
  conversation.updatedAt = new Date().toISOString();
  updateConversation(conversation);
  return c.json({ conversation });
});

conversationsRoutes.delete("/:id", (c) => {
  const id = c.req.param("id");
  if (isSystemConversationId(id)) {
    return c.json({ error: "系统会话不可删除" }, 403);
  }
  const ok = deleteConversation(id);
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});
