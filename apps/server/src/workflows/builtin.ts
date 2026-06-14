import type { WorkflowDefinition } from "@openx/shared";
import { listBuiltinWorkflowSummaries } from "@openx/shared";

/** 内置可执行 Workflow（与 operator-playbook 对齐，可 POST /api/operator/workflows/:id/run） */
export const BUILTIN_WORKFLOWS: WorkflowDefinition[] = [
  {
    id: "onboard_connect",
    title: "添加 Connect Agent",
    description: "注册 CliProfile → bootstrap → 验证 executors 在线",
    minTier: "read",
    steps: [
      {
        id: "cli_profile_create",
        title: "写入 Connect CliProfile",
        call: {
          method: "POST",
          path: "/api/cli/profiles",
          body: {
            kind: "connect",
            executorId: "{{executorId}}",
            displayName: "{{displayName}}",
            command: "{{command}}",
          },
          summary: "Workflow：创建 Connect CliProfile",
        },
        expectStatus: 201,
      },
      {
        id: "cli_bootstrap",
        title: "一键自举 connect-client",
        call: {
          method: "POST",
          path: "/api/cli/profiles/{{executorId}}/bootstrap",
          body: { wait: true },
          summary: "Workflow：bootstrap Connect",
        },
      },
      {
        id: "wait_boot",
        title: "等待进程就绪",
        wait: { kind: "delay", ms: 2000 },
      },
      {
        id: "verify_executors",
        title: "验证在线",
        call: {
          method: "GET",
          path: "/api/executors",
        },
        expectStatus: 200,
      },
    ],
  },
  {
    id: "goal_review_batch",
    title: "批量触发审查",
    description: "对 awaiting_review 目标触发审查（vars.goalId）",
    minTier: "read",
    steps: [
      {
        id: "fetch_goal",
        title: "读取目标状态",
        call: {
          method: "GET",
          path: "/api/goals/{{goalId}}",
        },
        expectStatus: 200,
      },
      {
        id: "trigger_review",
        title: "触发审查",
        call: {
          method: "POST",
          path: "/api/goals/{{goalId}}/trigger-review",
          body: { force: true },
          summary: "Workflow：触发目标审查",
        },
      },
    ],
  },
  {
    id: "memory_distill",
    title: "蒸馏项目记忆",
    description: "汇总近期失败/审查经验写入 MEMORY（vars.projectId）",
    minTier: "read",
    steps: [
      {
        id: "distill",
        title: "执行蒸馏",
        call: {
          method: "POST",
          path: "/api/projects/{{projectId}}/memory/distill",
        },
        expectStatus: 200,
      },
    ],
  },
];

export function getBuiltinWorkflow(id: string): WorkflowDefinition | undefined {
  return BUILTIN_WORKFLOWS.find((flow) => flow.id === id);
}

export function listBuiltinWorkflows() {
  const summaries = listBuiltinWorkflowSummaries();
  return summaries.map((summary) => {
    const flow = BUILTIN_WORKFLOWS.find((item) => item.id === summary.id);
    return {
      ...summary,
      stepCount: flow?.steps.length ?? summary.stepCount,
    };
  });
}
