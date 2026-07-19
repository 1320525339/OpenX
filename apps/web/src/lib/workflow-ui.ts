import { DISPATCH_PERMISSION_LABELS, type DispatchPermissionMode } from "@openx/shared";

export const PERMISSION_PICKER_OPTIONS: Array<{
  id: "default" | DispatchPermissionMode;
  label: string;
  description: string;
}> = [
  { id: "default", label: "默认", description: "不额外约束，由任务/子任务决定" },
  ...(
    Object.entries(DISPATCH_PERMISSION_LABELS) as Array<
      [DispatchPermissionMode, { label: string; description: string }]
    >
  ).map(([id, meta]) => ({
    id,
    label: meta.label,
    description: meta.description,
  })),
];

/** 任务台 / 顶栏共用的状态筛选标签 */
export const GOAL_STATUS_FILTER_LABELS: Record<string, string> = {
  all: "全部",
  incomplete: "未完成",
  failed: "失败",
  done: "已完成",
  rework: "返工中",
};

export const GOAL_STATUS_FILTERS: { key: string; label: string }[] = [
  { key: "all", label: GOAL_STATUS_FILTER_LABELS.all },
  { key: "incomplete", label: GOAL_STATUS_FILTER_LABELS.incomplete },
  { key: "failed", label: GOAL_STATUS_FILTER_LABELS.failed },
  { key: "done", label: GOAL_STATUS_FILTER_LABELS.done },
  { key: "rework", label: GOAL_STATUS_FILTER_LABELS.rework },
];
