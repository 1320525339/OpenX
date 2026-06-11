import { z } from "zod";
import type { Goal } from "./goal.js";

export const FileDeliverableActionSchema = z.enum(["created", "modified"]);
export type FileDeliverableAction = z.infer<typeof FileDeliverableActionSchema>;

export const GoalDeliverableSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("file"),
    path: z.string(),
    label: z.string().optional(),
    action: FileDeliverableActionSchema.optional(),
    /** 写入/修改时的内容摘录（after），用于交付预览 */
    preview: z.string().optional(),
    /** 修改前的文件快照（before），用于 diff */
    previousContent: z.string().optional(),
    language: z.string().optional(),
  }),
  z.object({
    kind: z.literal("snippet"),
    language: z.string().optional(),
    code: z.string(),
    label: z.string().optional(),
  }),
  z.object({
    kind: z.literal("link"),
    url: z.string(),
    label: z.string().optional(),
  }),
]);
export type GoalDeliverable = z.infer<typeof GoalDeliverableSchema>;

const FILE_PATH_RE =
  /(?:^|[\s"'`（(])([A-Za-z]:\\[^\s"'`，。；;]+|\/[^\s"'`，。；;]+|\.\/[^\s"'`，。；;]+|[\w./-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|json|md|txt|html|css|yaml|yml|toml|xml|sql))(?=[\s"'`，。；;)\]]|$)/g;

const FENCED_CODE_RE = /```(\w*)\n([\s\S]*?)```/g;

function basename(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i >= 0 ? norm.slice(i + 1) : norm;
}

export function languageFromPath(filePath: string): string | undefined {
  const ext = filePath.replace(/\\/g, "/").split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    py: "python",
    go: "go",
    rs: "rust",
    java: "java",
    json: "json",
    md: "markdown",
    html: "html",
    css: "css",
    yaml: "yaml",
    yml: "yaml",
    sql: "sql",
  };
  return ext ? map[ext] : undefined;
}

/** 从执行结果摘要文本启发式解析交付物（兼容旧数据） */
export function parseDeliverablesFromSummary(
  summary?: string | null,
): GoalDeliverable[] {
  if (!summary?.trim()) return [];
  const items: GoalDeliverable[] = [];
  const seenFiles = new Set<string>();

  let m: RegExpExecArray | null;
  FENCED_CODE_RE.lastIndex = 0;
  while ((m = FENCED_CODE_RE.exec(summary)) !== null) {
    const code = m[2]?.trim();
    if (!code || code.length < 4) continue;
    items.push({
      kind: "snippet",
      language: m[1] || undefined,
      code: code.length > 600 ? `${code.slice(0, 600)}…` : code,
      label: m[1] ? `${m[1]} 片段` : "代码片段",
    });
    if (items.filter((i) => i.kind === "snippet").length >= 2) break;
  }

  FILE_PATH_RE.lastIndex = 0;
  while ((m = FILE_PATH_RE.exec(summary)) !== null) {
    const filePath = m[1]?.trim();
    if (!filePath || filePath.length < 3 || seenFiles.has(filePath)) continue;
    if (/\.(exe|dll|png|jpg|gif|webp)$/i.test(filePath)) continue;
    seenFiles.add(filePath);
    items.push({
      kind: "file",
      path: filePath,
      label: basename(filePath),
      language: languageFromPath(filePath),
    });
    if (items.filter((i) => i.kind === "file").length >= 6) break;
  }

  return items;
}

/** 优先使用结构化 deliverables，否则从 resultSummary 解析 */
export function resolveGoalDeliverables(goal: Pick<Goal, "deliverables" | "resultSummary">): GoalDeliverable[] {
  if (goal.deliverables?.length) return goal.deliverables;
  return parseDeliverablesFromSummary(goal.resultSummary);
}

export function deliverableSummaryLabel(items: GoalDeliverable[]): string | null {
  const files = items.filter((i) => i.kind === "file").length;
  const snippets = items.filter((i) => i.kind === "snippet").length;
  const links = items.filter((i) => i.kind === "link").length;
  if (files === 0 && snippets === 0 && links === 0) return null;
  const parts: string[] = [];
  if (files > 0) parts.push(`${files} 个文件`);
  if (snippets > 0) parts.push(`${snippets} 段代码`);
  if (links > 0) parts.push(`${links} 个链接`);
  return parts.join(" · ");
}
