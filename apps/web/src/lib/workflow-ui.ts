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
