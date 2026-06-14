import { z } from "zod";
import { OperatorTierSchema, type OperatorTier } from "./operator-tier.js";

export const WorkflowCallStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  call: z.object({
    method: z.string().min(1),
    path: z.string().min(1),
    pathParams: z.record(z.string()).optional(),
    query: z.record(z.string()).optional(),
    body: z.unknown().optional(),
    summary: z.string().optional(),
    skipConfirm: z.boolean().optional(),
  }),
  expectStatus: z.number().int().optional(),
});
export type WorkflowCallStep = z.infer<typeof WorkflowCallStepSchema>;

export const WorkflowDelayWaitSchema = z.object({
  kind: z.literal("delay"),
  ms: z.number().int().min(0).max(120_000),
});

export const WorkflowExecutorWaitSchema = z.object({
  kind: z.literal("executor_online"),
  executorId: z.string().min(1),
  timeoutMs: z.number().int().min(1_000).max(300_000).optional(),
  pollMs: z.number().int().min(200).max(10_000).optional(),
});

export const WorkflowWaitStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  wait: z.discriminatedUnion("kind", [
    WorkflowDelayWaitSchema,
    WorkflowExecutorWaitSchema,
  ]),
});
export type WorkflowWaitStep = z.infer<typeof WorkflowWaitStepSchema>;

export const WorkflowStepSchema = z.union([
  WorkflowCallStepSchema,
  WorkflowWaitStepSchema,
]);
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

export const WorkflowDefinitionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  minTier: OperatorTierSchema.default("read"),
  steps: z.array(WorkflowStepSchema).min(1),
});
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

export const RunWorkflowInputSchema = z.object({
  vars: z.record(z.string()).optional(),
  stopOnError: z.boolean().optional(),
});
export type RunWorkflowInput = z.infer<typeof RunWorkflowInputSchema>;

export type WorkflowStepResult = {
  id: string;
  ok: boolean;
  detail: string;
  status?: number;
  pendingActionId?: string;
};

export type WorkflowRunResult = {
  workflowId: string;
  ok: boolean;
  steps: WorkflowStepResult[];
};

export type WorkflowSummary = {
  id: string;
  title: string;
  description?: string;
  minTier: OperatorTier;
  stepCount: number;
};

/** 内置 Workflow 元数据（前端展示与服务端列表 API 对齐） */
export const BUILTIN_WORKFLOW_SUMMARIES: WorkflowSummary[] = [
  {
    id: "onboard_connect",
    title: "添加 Connect Agent",
    description: "注册 CliProfile → bootstrap → 验证 executors 在线",
    minTier: "read",
    stepCount: 4,
  },
  {
    id: "goal_review_batch",
    title: "批量触发审查",
    description: "对 awaiting_review 目标触发审查（vars.goalId）",
    minTier: "read",
    stepCount: 2,
  },
  {
    id: "memory_distill",
    title: "蒸馏项目记忆",
    description: "汇总近期失败/审查经验写入 MEMORY（vars.projectId）",
    minTier: "read",
    stepCount: 1,
  },
];

export function listBuiltinWorkflowSummaries(): WorkflowSummary[] {
  return BUILTIN_WORKFLOW_SUMMARIES;
}

/** 将 {{var}} 占位符替换为运行时变量 */
export function renderWorkflowTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

export function renderWorkflowRecord(
  input: Record<string, string> | undefined,
  vars: Record<string, string>,
): Record<string, string> | undefined {
  if (!input) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    out[key] = renderWorkflowTemplate(value, vars);
  }
  return out;
}
