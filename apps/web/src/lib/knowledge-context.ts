import type { KnowledgeContextSelection, KnowledgeSourceRef } from "@openx/shared";

export type KnowledgePickerItem = {
  id: string;
  label: string;
  group: "scope" | "source";
  scopeKey?: "global" | "project" | "runtime";
};

const ALL_SELECTION: KnowledgeContextSelection = { mode: "all" };

function knowledgeKey(projectId?: string): string {
  return projectId
    ? `openx.chat.knowledge.project.${projectId}`
    : "openx.chat.knowledge.global";
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function loadKnowledgeSelection(projectId?: string): KnowledgeContextSelection {
  return readJson(knowledgeKey(projectId), ALL_SELECTION);
}

export function saveKnowledgeSelection(
  selection: KnowledgeContextSelection,
  projectId?: string,
): void {
  localStorage.setItem(knowledgeKey(projectId), JSON.stringify(selection));
}

export function buildKnowledgePickerItems(opts: {
  isSystemMain: boolean;
  globalSources: KnowledgeSourceRef[];
  projectSources: KnowledgeSourceRef[];
}): KnowledgePickerItem[] {
  const items: KnowledgePickerItem[] = [];
  if (opts.isSystemMain) {
    items.push({ id: "__global__", label: "全局知识", group: "scope", scopeKey: "global" });
  } else {
    items.push({ id: "__project__", label: "项目用户知识", group: "scope", scopeKey: "project" });
    items.push({ id: "__runtime__", label: "项目运行知识", group: "scope", scopeKey: "runtime" });
    items.push({
      id: "__global_readonly__",
      label: "全局知识（只读参考）",
      group: "scope",
      scopeKey: "global",
    });
  }
  for (const src of opts.globalSources) {
    items.push({ id: src.id, label: `全局：${src.label}`, group: "source" });
  }
  for (const src of opts.projectSources) {
    items.push({ id: src.id, label: `项目：${src.label}`, group: "source" });
  }
  return items;
}

export function selectionToEnabledMap(
  items: KnowledgePickerItem[],
  selection: KnowledgeContextSelection,
): Record<string, boolean> {
  if (selection.mode === "all") {
    return Object.fromEntries(items.map((item) => [item.id, true]));
  }
  const map: Record<string, boolean> = {};
  for (const item of items) {
    if (item.scopeKey === "global") {
      map[item.id] = selection.includeGlobal !== false;
    } else if (item.scopeKey === "project") {
      map[item.id] = selection.includeProject !== false;
    } else if (item.scopeKey === "runtime") {
      map[item.id] = selection.includeRuntime !== false;
    } else {
      map[item.id] = selection.sourceIds?.includes(item.id) ?? false;
    }
  }
  return map;
}

export function enabledMapToSelection(
  items: KnowledgePickerItem[],
  enabled: Record<string, boolean>,
): KnowledgeContextSelection {
  const allOn = items.every((item) => enabled[item.id]);
  if (allOn) return ALL_SELECTION;

  const sourceIds = items
    .filter((item) => item.group === "source" && enabled[item.id])
    .map((item) => item.id);

  const globalScope = items.find((i) => i.scopeKey === "global");
  const projectScope = items.find((i) => i.scopeKey === "project");
  const runtimeScope = items.find((i) => i.scopeKey === "runtime");

  return {
    mode: "custom",
    sourceIds,
    includeGlobal: globalScope ? enabled[globalScope.id] : undefined,
    includeProject: projectScope ? enabled[projectScope.id] : undefined,
    includeRuntime: runtimeScope ? enabled[runtimeScope.id] : undefined,
  };
}

export function knowledgeSelectionLabel(
  selection: KnowledgeContextSelection,
  enabledCount: number,
  total: number,
): string {
  if (selection.mode === "all" || enabledCount === total) return "全部";
  if (enabledCount === 0) return "无";
  return `${enabledCount}`;
}
