import {
  renderWorkflowRecord,
  renderWorkflowTemplate,
  tierSatisfies,
  type OperatorTier,
  type WorkflowCallStep,
  type WorkflowDefinition,
  type WorkflowRunResult,
  type WorkflowStep,
  type WorkflowStepResult,
  type WorkflowWaitStep,
} from "@openx/shared";
import { operatorCallApi } from "./operator-gateway.js";
import { detectExecutors } from "./orchestrator.js";

function isCallStep(step: WorkflowStep): step is WorkflowCallStep {
  return "call" in step;
}

function isWaitStep(step: WorkflowStep): step is WorkflowWaitStep {
  return "wait" in step;
}

async function waitForExecutorOnline(
  executorId: string,
  timeoutMs: number,
  pollMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const executors = await detectExecutors();
    const hit = executors.find(
      (item) => item.id === executorId || item.id.includes(executorId),
    );
    if (hit?.available) return true;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return false;
}

async function executeCallStep(
  tier: OperatorTier,
  step: WorkflowCallStep,
  vars: Record<string, string>,
): Promise<WorkflowStepResult> {
  const path = renderWorkflowTemplate(step.call.path, vars);
  const pathParams = renderWorkflowRecord(step.call.pathParams, vars);
  const query = renderWorkflowRecord(step.call.query, vars);
  let body = step.call.body;
  if (body && typeof body === "object") {
    body = JSON.parse(
      renderWorkflowTemplate(JSON.stringify(body), vars),
    ) as unknown;
  }

  const outcome = await operatorCallApi(
    tier,
    {
      method: step.call.method,
      path,
      pathParams,
      query,
      body,
      summary: step.call.summary ?? `Workflow ${step.id}`,
    },
    { skipConfirm: step.call.skipConfirm },
  );

  if (outcome.kind === "pending") {
    return {
      id: step.id,
      ok: false,
      detail: `等待用户确认 admin 操作：${outcome.pendingActionId}`,
      pendingActionId: outcome.pendingActionId,
    };
  }

  const status = outcome.result.status;
  const expect = step.expectStatus;
  const ok = expect != null ? status === expect : outcome.result.ok;
  return {
    id: step.id,
    ok,
    status,
    detail: ok
      ? `${step.call.method} ${path} → ${status}`
      : outcome.result.error ?? `HTTP ${status}`,
  };
}

async function executeWaitStep(
  step: WorkflowWaitStep,
  vars: Record<string, string>,
): Promise<WorkflowStepResult> {
  const wait = step.wait;
  if (wait.kind === "delay") {
    await new Promise((resolve) => setTimeout(resolve, wait.ms));
    return { id: step.id, ok: true, detail: `delay ${wait.ms}ms` };
  }

  const executorId = renderWorkflowTemplate(wait.executorId, vars);
  const timeoutMs = wait.timeoutMs ?? 30_000;
  const pollMs = wait.pollMs ?? 1_500;
  const online = await waitForExecutorOnline(executorId, timeoutMs, pollMs);
  return {
    id: step.id,
    ok: online,
    detail: online
      ? `executor ${executorId} online`
      : `executor ${executorId} 未在 ${timeoutMs}ms 内上线`,
  };
}

export async function runWorkflowDefinition(
  workflow: WorkflowDefinition,
  tier: OperatorTier,
  opts?: { vars?: Record<string, string>; stopOnError?: boolean },
): Promise<WorkflowRunResult> {
  if (!tierSatisfies(tier, workflow.minTier)) {
    return {
      workflowId: workflow.id,
      ok: false,
      steps: [
        {
          id: "tier",
          ok: false,
          detail: `需要 ${workflow.minTier} 权限，当前 ${tier}`,
        },
      ],
    };
  }

  const vars = opts?.vars ?? {};
  const steps: WorkflowStepResult[] = [];
  for (const step of workflow.steps) {
    const result = isCallStep(step)
      ? await executeCallStep(tier, step, vars)
      : isWaitStep(step)
        ? await executeWaitStep(step, vars)
        : { id: "unknown", ok: false, detail: "未知步骤类型" };
    steps.push(result);
    if (!result.ok && opts?.stopOnError !== false) {
      return { workflowId: workflow.id, ok: false, steps };
    }
  }
  return {
    workflowId: workflow.id,
    ok: steps.every((step) => step.ok),
    steps,
  };
}
