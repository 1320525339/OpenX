import { z } from "zod";

/** FTS / 索引用的全局知识占位 project_id */
export const GLOBAL_KNOWLEDGE_PROJECT_ID = "__global__";

export const KnowledgeScopeSchema = z.enum(["global", "user", "runtime"]);
export type KnowledgeScope = z.infer<typeof KnowledgeScopeSchema>;

export const KnowledgeCategorySchema = z.enum([
  "fact",
  "decision",
  "constraint",
  "lesson",
  "sop",
  "preference",
]);
export type KnowledgeCategory = z.infer<typeof KnowledgeCategorySchema>;

export const KnowledgeSourceSchema = z.enum([
  "manual",
  "distill",
  "coach",
  "review",
  "promoted",
  "imported",
]);
export type KnowledgeSource = z.infer<typeof KnowledgeSourceSchema>;

export const KnowledgeSourceKindSchema = z.enum(["path", "url"]);
export type KnowledgeSourceKind = z.infer<typeof KnowledgeSourceKindSchema>;

/** 根据输入自动判断：http(s) 为网页，否则为本地路径（对齐 OpenClaw extraPaths 心智） */
export function inferKnowledgeSourceKind(uri: string): KnowledgeSourceKind {
  const first =
    uri
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? uri.trim();
  return /^https?:\/\//i.test(first) ? "url" : "path";
}

export const KnowledgeSourceStatusSchema = z.enum([
  "pending",
  "indexing",
  "ready",
  "error",
]);
export type KnowledgeSourceStatus = z.infer<typeof KnowledgeSourceStatusSchema>;

/** 外部知识源（本地路径或网页 URL 列表） */
export const KnowledgeSourceRefSchema = z.object({
  id: z.string(),
  scope: z.enum(["global", "user"]),
  projectId: z.string().optional(),
  kind: KnowledgeSourceKindSchema,
  label: z.string().min(1),
  /** 本地路径，或换行分隔的 URL 列表 */
  uri: z.string().min(1),
  includePatterns: z.array(z.string()).optional(),
  excludePatterns: z.array(z.string()).optional(),
  status: KnowledgeSourceStatusSchema,
  lastIndexedAt: z.string().optional(),
  docCount: z.number().int().min(0).default(0),
  error: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type KnowledgeSourceRef = z.infer<typeof KnowledgeSourceRefSchema>;

export const CreateKnowledgeSourceSchema = z
  .object({
    /** 省略时根据 uri 自动推断 */
    kind: KnowledgeSourceKindSchema.optional(),
    /** 省略时由导入内容自动蒸馏生成 */
    label: z.string().min(1).optional(),
    uri: z.string().min(1),
    includePatterns: z.array(z.string()).optional(),
    excludePatterns: z.array(z.string()).optional(),
  })
  .transform((input) => ({
    ...input,
    kind: input.kind ?? inferKnowledgeSourceKind(input.uri),
  }));
export type CreateKnowledgeSourceBody = z.input<typeof CreateKnowledgeSourceSchema>;
export type CreateKnowledgeSourceInput = z.output<typeof CreateKnowledgeSourceSchema>;

export const UpdateKnowledgeSourceSchema = z.object({
  label: z.string().min(1).optional(),
  uri: z.string().min(1).optional(),
  includePatterns: z.array(z.string()).optional(),
  excludePatterns: z.array(z.string()).optional(),
});
export type UpdateKnowledgeSourceInput = z.infer<typeof UpdateKnowledgeSourceSchema>;

/** 对话中本次启用的知识库范围 */
export const KnowledgeContextSelectionSchema = z.object({
  mode: z.enum(["all", "custom"]).default("all"),
  /** custom 模式下启用的知识源 id */
  sourceIds: z.array(z.string()).optional(),
  includeGlobal: z.boolean().optional(),
  includeProject: z.boolean().optional(),
  includeRuntime: z.boolean().optional(),
});
export type KnowledgeContextSelection = z.infer<typeof KnowledgeContextSelectionSchema>;

export const KnowledgeEntrySchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  content: z.string(),
  category: KnowledgeCategorySchema.default("fact"),
  tags: z.array(z.string()).default([]),
  source: KnowledgeSourceSchema.default("manual"),
  scope: KnowledgeScopeSchema,
  projectId: z.string().optional(),
  sourceRefId: z.string().optional(),
  sourceUri: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type KnowledgeEntry = z.infer<typeof KnowledgeEntrySchema>;

export const CreateKnowledgeEntrySchema = z.object({
  title: z.string().min(1),
  content: z.string().min(1),
  category: KnowledgeCategorySchema.optional(),
  tags: z.array(z.string()).optional(),
  source: KnowledgeSourceSchema.optional(),
});
export type CreateKnowledgeEntryInput = z.infer<typeof CreateKnowledgeEntrySchema>;

export const UpdateKnowledgeEntrySchema = z.object({
  title: z.string().min(1).optional(),
  content: z.string().min(1).optional(),
  category: KnowledgeCategorySchema.optional(),
  tags: z.array(z.string()).optional(),
});
export type UpdateKnowledgeEntryInput = z.infer<typeof UpdateKnowledgeEntrySchema>;

export const PromoteKnowledgeSchema = z.object({
  entryId: z.string().min(1),
  fromScope: z.enum(["user", "runtime"]),
  toScope: z.enum(["user", "global"]),
  /** runtime 提升时指定 MEMORY.md 章节标题 */
  runtimeHeading: z.string().optional(),
});
export type PromoteKnowledgeInput = z.infer<typeof PromoteKnowledgeSchema>;

export const SaveKnowledgeSchema = CreateKnowledgeEntrySchema.extend({
  projectId: z.string().min(1),
});
export type SaveKnowledgeInput = z.infer<typeof SaveKnowledgeSchema>;

export const KNOWLEDGE_CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  fact: "事实",
  decision: "决策",
  constraint: "约束",
  lesson: "教训",
  sop: "流程",
  preference: "偏好",
};

export type KnowledgeEntryFrontmatter = {
  title: string;
  category?: KnowledgeCategory;
  tags?: string[];
  source?: KnowledgeSource;
  sourceRefId?: string;
  sourceUri?: string;
  createdAt: string;
  updatedAt: string;
};

/** 解析 knowledge entry markdown（YAML frontmatter + body） */
export function parseKnowledgeEntryFile(
  id: string,
  scope: KnowledgeScope,
  raw: string,
  projectId?: string,
): KnowledgeEntry | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  const yaml = match[1];
  const content = match[2].trim();
  const meta: Record<string, string> = {};
  for (const line of yaml.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  const title = meta.title?.trim();
  if (!title) return null;
  const tagsRaw = meta.tags?.trim();
  const tags =
    tagsRaw && tagsRaw.startsWith("[")
      ? tagsRaw
          .slice(1, -1)
          .split(",")
          .map((t) => t.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean)
      : [];
  const categoryParsed = KnowledgeCategorySchema.safeParse(meta.category?.trim());
  const sourceParsed = KnowledgeSourceSchema.safeParse(meta.source?.trim());
  const createdAt = meta.createdAt?.trim() || new Date(0).toISOString();
  const updatedAt = meta.updatedAt?.trim() || createdAt;
  const sourceRefId = meta.sourceRefId?.trim() || undefined;
  const sourceUri = meta.sourceUri?.trim() || undefined;
  return {
    id,
    title,
    content,
    category: categoryParsed.success ? categoryParsed.data : "fact",
    tags,
    source: sourceParsed.success ? sourceParsed.data : "manual",
    scope,
    projectId,
    sourceRefId,
    sourceUri,
    createdAt,
    updatedAt,
  };
}

export function formatKnowledgeEntryFile(entry: KnowledgeEntry): string {
  const tags =
    entry.tags.length > 0
      ? `tags: [${entry.tags.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(", ")}]`
      : "tags: []";
  const lines = [
    "---",
    `title: ${entry.title}`,
    `category: ${entry.category}`,
    tags,
    `source: ${entry.source}`,
  ];
  if (entry.sourceRefId) lines.push(`sourceRefId: ${entry.sourceRefId}`);
  if (entry.sourceUri) lines.push(`sourceUri: ${entry.sourceUri}`);
  lines.push(
    `createdAt: ${entry.createdAt}`,
    `updatedAt: ${entry.updatedAt}`,
    "---",
    "",
    entry.content.trim(),
    "",
  );
  return lines.join("\n");
}

export function formatKnowledgeHitsForPrompt(
  label: string,
  hits: Array<{ content: string; sourceUri?: string }>,
): string | undefined {
  if (hits.length === 0) return undefined;
  const body = hits
    .map((hit, index) => {
      const sourceLine = hit.sourceUri ? `（来源：${hit.sourceUri}）\n` : "";
      return `### 命中 ${index + 1}\n${sourceLine}${hit.content.trim()}`;
    })
    .join("\n\n");
  return `## ${label}\n${body}`;
}

export function formatKnowledgeSelectionSummaryBlock(opts: {
  mode: "all" | "custom";
  enabledLabels: string[];
  disabledLabels?: string[];
}): string {
  const enabled =
    opts.enabledLabels.length > 0
      ? opts.enabledLabels.map((l) => `· ${l}`).join("\n")
      : "· （无）";
  const lines = [
    "## 当前启用知识库",
    `模式：${opts.mode === "all" ? "全部" : "自定义"}`,
    enabled,
  ];
  if (opts.disabledLabels && opts.disabledLabels.length > 0) {
    lines.push(
      "",
      "本轮未启用：",
      ...opts.disabledLabels.map((l) => `· ${l}`),
    );
  }
  return lines.join("\n");
}
