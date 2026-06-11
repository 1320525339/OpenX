import { z } from "zod";

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  workspaceDir: z.string(),
  createdAt: z.string(),
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
});
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;

export const ConversationSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const CreateConversationSchema = z.object({
  title: z.string().optional(),
});
export type CreateConversationInput = z.infer<typeof CreateConversationSchema>;

export const UpdateConversationSchema = z.object({
  title: z.string().min(1),
});
export type UpdateConversationInput = z.infer<typeof UpdateConversationSchema>;
