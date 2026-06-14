import { DISPATCH_PERMISSION_LABELS, type DispatchPermissionMode } from "@openx/shared";

export type WorkflowListItem = {
  id: string;
  title: string;
  description?: string;
  minTier: string;
  stepCount: number;
};

export type WorkflowVarField = {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
};

/** 内置 Workflow 变量表单（与 apps/server workflows/builtin 对齐） */
export const WORKFLOW_VAR_SCHEMA: Record<
  string,
  { fields: WorkflowVarField[] }
> = {
  onboard_connect: {
    fields: [
      { key: "executorId", label: "执行器 ID", placeholder: "my-connect-agent", required: true },
      { key: "displayName", label: "显示名称", placeholder: "My Connect Agent", required: true },
      { key: "command", label: "启动命令", placeholder: "node connect-client.js", required: true },
    ],
  },
  goal_review_batch: {
    fields: [{ key: "goalId", label: "目标 ID", required: true }],
  },
  memory_distill: {
    fields: [{ key: "projectId", label: "项目 ID", required: true }],
  },
};

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
