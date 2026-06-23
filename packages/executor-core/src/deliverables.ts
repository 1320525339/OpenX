import {
  languageFromPath,
  type FileDeliverableAction,
  type GoalDeliverable,
} from "@openx/shared";

const WRITE_TOOL_RE =
  /^(write|edit|write_file|edit_file|create_file|apply_patch|str_replace|patch|save|touch)$/i;

const CREATE_TOOL_RE = /^(write|write_file|create_file|touch)$/i;

function basename(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i >= 0 ? norm.slice(i + 1) : norm;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export function extractPathFromToolArgs(args: unknown): string | undefined {
  const rec = asRecord(args);
  if (!rec) return undefined;
  return pickString(rec, [
    "path",
    "file_path",
    "filePath",
    "file",
    "target",
    "relativePath",
    "relative_path",
  ]);
}

function extractPreviewFromPayload(payload: unknown, depth = 0): string | undefined {
  if (depth > 5) return undefined;
  const rec = asRecord(payload);
  if (!rec) {
    if (typeof payload === "string" && payload.trim()) return payload.trim();
    return undefined;
  }
  const direct = pickString(rec, [
    "content",
    "new_content",
    "newContent",
    "text",
    "body",
    "code",
    "patch",
    "diff",
  ]);
  if (direct) return direct;
  const nested = asRecord(rec.result) ?? asRecord(rec.data);
  if (nested) return extractPreviewFromPayload(nested, depth + 1);
  return undefined;
}

export function inferFileAction(toolName: string): FileDeliverableAction {
  return CREATE_TOOL_RE.test(toolName) ? "created" : "modified";
}

export function extractDeliverableFromTool(
  toolName: string,
  args: unknown,
  result: unknown,
  isError: boolean,
  opts?: { previousContent?: string },
): GoalDeliverable | null {
  if (isError) return null;
  const path = extractPathFromToolArgs(args);
  if (!path) {
    if (!WRITE_TOOL_RE.test(toolName)) return null;
    return null;
  }
  const preview =
    extractPreviewFromPayload(args) ?? extractPreviewFromPayload(result);
  const clipped =
    preview && preview.length > 4000 ? `${preview.slice(0, 4000)}…` : preview;
  const previous = opts?.previousContent;
  const previousClipped =
    previous && previous.length > 4000 ? `${previous.slice(0, 4000)}…` : previous;
  const action =
    previousClipped !== undefined
      ? "modified"
      : inferFileAction(toolName);
  return {
    kind: "file",
    path,
    label: basename(path),
    action,
    preview: clipped,
    previousContent: previousClipped,
    language: languageFromPath(path),
  };
}

/** 同路径文件交付物合并（保留最新预览与 action） */
export function mergeDeliverable(
  list: GoalDeliverable[],
  item: GoalDeliverable,
): GoalDeliverable[] {
  if (item.kind !== "file") {
    const dupSnippet =
      item.kind === "snippet" &&
      list.some(
        (d) => d.kind === "snippet" && d.code === item.code && d.label === item.label,
      );
    if (!dupSnippet) list.push(item);
    return list;
  }

  const idx = list.findIndex((d) => d.kind === "file" && d.path === item.path);
  if (idx < 0) {
    list.push(item);
    return list;
  }
  const prev = list[idx];
  if (prev.kind !== "file") return list;
  list[idx] = {
    ...prev,
    ...item,
    action: item.action ?? prev.action,
    preview: item.preview ?? prev.preview,
    previousContent: prev.previousContent ?? item.previousContent,
    language: item.language ?? prev.language,
    label: item.label ?? prev.label,
  };
  return list;
}
