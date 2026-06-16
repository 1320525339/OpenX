import type { DockMode } from "./use-desktop-layout";

/** 柔性主屏上的 Widget 卡片 ID */
export type CanvasWidgetId =
  | "chat"
  | "tasks"
  | "artifacts"
  | "run"
  | "review"
  | "fleet";

export type FlexibleScope = "console" | "conversation";

export type FlexiblePreset = {
  primary: CanvasWidgetId;
  secondary?: CanvasWidgetId;
  /** 主 Widget 占比（0–1），仅在 secondary 已 Pin 时生效 */
  defaultSplitRatio: number;
  defaultSecondaryPinned: boolean;
  minPrimaryRatio: number;
  maxPrimaryRatio: number;
};

export const WIDGET_LABELS: Record<CanvasWidgetId, string> = {
  chat: "对话",
  tasks: "任务看板",
  artifacts: "产物预览",
  run: "执行过程",
  review: "待验收",
  fleet: "执行器调度",
};

/** 底栏模式 → 默认画布组合（对齐 HyperOS 柔性桌面 / 多场景预设） */
export const DOCK_FLEX_PRESETS: Record<DockMode, FlexiblePreset> = {
  chat: {
    primary: "chat",
    secondary: "review",
    defaultSplitRatio: 0.62,
    defaultSecondaryPinned: true,
    minPrimaryRatio: 0.45,
    maxPrimaryRatio: 0.82,
  },
  tasks: {
    primary: "tasks",
    defaultSplitRatio: 1,
    defaultSecondaryPinned: false,
    minPrimaryRatio: 1,
    maxPrimaryRatio: 1,
  },
  /** 施工桌面：产物预览为主 + 对话辅栏，可 resize */
  artifacts: {
    primary: "artifacts",
    secondary: "chat",
    defaultSplitRatio: 0.58,
    defaultSecondaryPinned: true,
    minPrimaryRatio: 0.4,
    maxPrimaryRatio: 0.78,
  },
  fleet: {
    primary: "fleet",
    defaultSplitRatio: 1,
    defaultSecondaryPinned: false,
    minPrimaryRatio: 1,
    maxPrimaryRatio: 1,
  },
};

function flexStorageKey(scope: FlexibleScope, dockMode: DockMode, kind: "ratio" | "pin") {
  return `openx.flex.${scope}.${dockMode}.${kind}`;
}

export function loadFlexSplitRatio(
  scope: FlexibleScope,
  dockMode: DockMode,
  preset: FlexiblePreset,
): number {
  try {
    const raw = localStorage.getItem(flexStorageKey(scope, dockMode, "ratio"));
    if (!raw) return preset.defaultSplitRatio;
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) return preset.defaultSplitRatio;
    return Math.min(preset.maxPrimaryRatio, Math.max(preset.minPrimaryRatio, n));
  } catch {
    return preset.defaultSplitRatio;
  }
}

export function saveFlexSplitRatio(
  scope: FlexibleScope,
  dockMode: DockMode,
  ratio: number,
): void {
  try {
    localStorage.setItem(flexStorageKey(scope, dockMode, "ratio"), String(ratio));
  } catch {
    /* ignore */
  }
}

export function loadFlexSecondaryPinned(
  scope: FlexibleScope,
  dockMode: DockMode,
  preset: FlexiblePreset,
): boolean {
  if (!preset.secondary) return false;
  try {
    const raw = localStorage.getItem(flexStorageKey(scope, dockMode, "pin"));
    if (raw === "0") return false;
    if (raw === "1") return true;
  } catch {
    /* ignore */
  }
  return preset.defaultSecondaryPinned;
}

export function saveFlexSecondaryPinned(
  scope: FlexibleScope,
  dockMode: DockMode,
  pinned: boolean,
): void {
  try {
    localStorage.setItem(flexStorageKey(scope, dockMode, "pin"), pinned ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function getFlexPreset(dockMode: DockMode): FlexiblePreset {
  return DOCK_FLEX_PRESETS[dockMode];
}
