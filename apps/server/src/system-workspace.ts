import type { Conversation, Project } from "@openx/shared";
import { loadSettings } from "./settings-store.js";
import {
  getConversationById,
  getProjectById,
  insertConversation,
  insertProject,
  updateProject,
} from "./db.js";
import {
  resolveSystemWorkspaceRoot,
  syncSystemWorkspaceLayout,
} from "./system-workspace-path.js";

export const SYSTEM_PROJECT_ID = "openx-system";
export const SYSTEM_CLI_CONVERSATION_ID = "openx-system-cli";
export const SYSTEM_MAIN_CONVERSATION_ID = "openx-system-main";

export function isSystemProjectId(id: string): boolean {
  return id === SYSTEM_PROJECT_ID;
}

export function isSystemConversationId(id: string): boolean {
  return id === SYSTEM_CLI_CONVERSATION_ID || id === SYSTEM_MAIN_CONVERSATION_ID;
}

function ensureSystemProject(): Project {
  const settings = loadSettings();
  const workspaceDir = syncSystemWorkspaceLayout(settings);
  let project = getProjectById(SYSTEM_PROJECT_ID);
  if (!project) {
    project = insertProject({
      id: SYSTEM_PROJECT_ID,
      name: "OpenX 系统",
      workspaceDir,
      createdAt: new Date().toISOString(),
    });
  } else if (project.workspaceDir !== workspaceDir) {
    project.workspaceDir = workspaceDir;
    updateProject(project);
  }
  return project;
}

/** 系统任务（CLI 接入、自举等）的专属项目与会话，不污染用户项目 */
export function ensureSystemCliConversation(): {
  project: Project;
  conversation: Conversation;
} {
  const project = ensureSystemProject();
  let conversation = getConversationById(SYSTEM_CLI_CONVERSATION_ID);
  if (!conversation) {
    const now = new Date().toISOString();
    conversation = insertConversation({
      id: SYSTEM_CLI_CONVERSATION_ID,
      projectId: SYSTEM_PROJECT_ID,
      title: "CLI 接入",
      createdAt: now,
      updatedAt: now,
    });
  }
  return { project, conversation };
}

/** 调度台主对话：系统级 Coach 与任务池 */
export function ensureSystemMainConversation(): {
  project: Project;
  conversation: Conversation;
} {
  const project = ensureSystemProject();
  let conversation = getConversationById(SYSTEM_MAIN_CONVERSATION_ID);
  if (!conversation) {
    const now = new Date().toISOString();
    conversation = insertConversation({
      id: SYSTEM_MAIN_CONVERSATION_ID,
      projectId: SYSTEM_PROJECT_ID,
      title: "调度台",
      createdAt: now,
      updatedAt: now,
    });
  }
  return { project, conversation };
}

export function getSystemWorkspaceDir(): string {
  return resolveSystemWorkspaceRoot(loadSettings());
}
