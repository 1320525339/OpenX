import { getConversationById, getProjectById } from "./db.js";
import { createKnowledgeEntry } from "./knowledge-store.js";
import { isSystemProjectId } from "./system-workspace.js";
import type { KnowledgeToolGateway } from "@openx/coach";

export function createCoachKnowledgeGateway(
  conversationId: string,
): KnowledgeToolGateway | null {
  const conversation = getConversationById(conversationId);
  if (!conversation) return null;
  if (isSystemProjectId(conversation.projectId)) return null;
  const project = getProjectById(conversation.projectId);
  if (!project) return null;

  return {
    projectId: project.id,
    projectName: project.name,
    saveEntry: async (input) => {
      const entry = createKnowledgeEntry(
        "user",
        {
          title: input.title,
          content: input.content,
          category: input.category,
          tags: input.tags,
          source: "coach",
        },
        project.id,
      );
      return {
        ok: true,
        entryId: entry.id,
        title: entry.title,
        detail: `已保存到项目「${project.name}」用户知识库`,
      };
    },
  };
}
