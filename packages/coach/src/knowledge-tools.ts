import { z } from "zod";
import type { KnowledgeCategory } from "@openx/shared";

export const KNOWLEDGE_SAVE_TOOL_NAME = "knowledge_save" as const;

export type KnowledgeSaveToolInput = {
  title: string;
  content: string;
  category?: KnowledgeCategory;
  tags?: string[];
};

export type KnowledgeSaveToolResult = {
  ok: boolean;
  entryId?: string;
  title?: string;
  detail: string;
};

export type KnowledgeToolGateway = {
  projectId: string;
  projectName?: string;
  saveEntry: (input: KnowledgeSaveToolInput) => Promise<KnowledgeSaveToolResult>;
};

export type KnowledgeToolCallResult = {
  name: typeof KNOWLEDGE_SAVE_TOOL_NAME;
  args: KnowledgeSaveToolInput;
  result: KnowledgeSaveToolResult;
};

export const KnowledgeSaveToolInputSchema = z.object({
  title: z.string().min(1).describe("知识条目标题，简短概括"),
  content: z.string().min(1).describe("知识正文，Markdown 可"),
  category: z
    .enum(["fact", "decision", "constraint", "lesson", "sop", "preference"])
    .optional()
    .describe("分类：fact/decision/constraint/lesson/sop/preference"),
  tags: z.array(z.string()).optional().describe("可选标签"),
});

export const KNOWLEDGE_SAVE_TOOL_DESCRIPTION =
  "将用户明确要求记住的项目知识写入项目用户知识库。从用户消息提取标题与正文后调用。";
