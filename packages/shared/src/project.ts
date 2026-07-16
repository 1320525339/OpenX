import { z } from "zod";
import { LlmContextSettingsSchema } from "./llm-context-config.js";
import { ConversationModeSchema } from "./roundtable.js";

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  workspaceDir: z.string(),
  createdAt: z.string(),
  /** 项目级 LLM 上下文覆盖（合并全局 settings.llmContext） */
  llmContext: LlmContextSettingsSchema.optional(),
});
export type Project = z.infer<typeof ProjectSchema>;

export const CreateProjectSchema = z.object({
  workspaceDir: z.string().min(1),
  name: z.string().optional(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

export const UpdateProjectSchema = z.object({
  name: z.string().optional(),
  workspaceDir: z.string().optional(),
  llmContext: LlmContextSettingsSchema.optional(),
});
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;

export const ConversationSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  /** 缺省为 foreman；圆桌会话为 roundtable */
  mode: ConversationModeSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const CreateConversationSchema = z.object({
  title: z.string().optional(),
  mode: ConversationModeSchema.optional(),
  participantProfileIds: z.array(z.string().min(1)).optional(),
});
export type CreateConversationInput = z.infer<typeof CreateConversationSchema>;

export const UpdateConversationSchema = z.object({
  title: z.string().min(1).optional(),
  mode: ConversationModeSchema.optional(),
}).refine((v) => v.title !== undefined || v.mode !== undefined, {
  message: "至少提供 title 或 mode",
});
export type UpdateConversationInput = z.infer<typeof UpdateConversationSchema>;
