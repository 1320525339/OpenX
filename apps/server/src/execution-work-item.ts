import { nanoid } from "nanoid";
import type { ExecutionWorkItem, Goal, IntegrationRun } from "@openx/shared";
import { getExecutor } from "@openx/executor-core";
import { loadSettings } from "./settings-store.js";
import { resolveSystemWorkspaceRoot } from "./system-workspace-path.js";
import { updateIntegrationRun } from "./integration-run-store.js";
import { broadcast } from "./sse.js";
import { resolveExecutorSkills } from "./skills-resolve.js";
import { ensureExecutors } from "./orchestrator.js";

function syntheticGoal(item: ExecutionWorkItem): Goal {
  const now = new Date().toISOString();
  // Integration 自动化无用户续跑通道：ask_write 强制升为 full，避免 park 悬挂
  const permissionMode =
    item.permissionMode === "ask_write" ? "full" : item.permissionMode;
  return {
    id: item.id,
    orderNo: 0,
    conversationId: item.conversationId ?? "openx-miloco-events",
    title: item.title,
    acceptance: "自动化运行完成即可",
    userDraft: item.title,
    executionPrompt: item.executionPrompt,
    constraints: [],
    executorId: "pi",
    dependsOn: [],
    priority: "medium",
    autoReview: false,
    iterationCount: 0,
    dispatchContext: {
      skillIds: item.skillIds,
      permissionMode,
    },
    status: "running",
    progress: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export type WorkItemResult = {
  ok: boolean;
  summary: string;
  error?: string;
};

/**
 * 执行 IntegrationRun 工作项：不写入 goals 表，仅更新 integration_runs。
 */
export async function executeIntegrationWorkItem(
  run: IntegrationRun,
  item: ExecutionWorkItem,
): Promise<WorkItemResult> {
  ensureExecutors();
  const settings = loadSettings();
  const adapter = getExecutor("pi");
  if (!adapter) {
    return { ok: false, summary: "", error: "Pi 执行器不可用" };
  }
  const workspaceRoot = resolveSystemWorkspaceRoot(settings);
  const { hints: enabledSkills } = resolveExecutorSkills(
    "pi",
    settings,
    item.skillIds,
  );

  let summary = "";
  let failed: string | undefined;
  const goal = syntheticGoal(item);

  const startedAt = new Date().toISOString();
  const running: IntegrationRun = {
    ...run,
    status: "running",
    startedAt,
    updatedAt: startedAt,
  };
  updateIntegrationRun(running);
  broadcast({
    type: "integration.run.updated",
    integrationId: run.integrationId,
    runId: run.id,
    status: "running",
    title: run.title,
    lane: run.lane,
    timestamp: startedAt,
  });

  await new Promise<void>((resolve) => {
    const timeoutMs = item.timeoutMs ?? 180_000;
    const timer = setTimeout(() => {
      failed = "执行超时";
      try {
        adapter.cancel?.(item.id);
      } catch {
        /* ignore */
      }
      resolve();
    }, timeoutMs);

    void adapter
      .run({
        goal,
        workspaceRoot,
        settings: {
          pi: settings.executors?.pi,
          model: settings.model,
          providers: settings.providers,
        },
        enabledSkills,
        callbacks: {
          onProgress: async () => {},
          onLog: async () => {},
          onComplete: async (resultSummary) => {
            summary = resultSummary;
            clearTimeout(timer);
            resolve();
          },
          onFail: async (errorMessage) => {
            failed = errorMessage;
            clearTimeout(timer);
            resolve();
          },
        },
      })
      .catch((err: Error) => {
        failed = err.message;
        clearTimeout(timer);
        resolve();
      });
  });

  const finishedAt = new Date().toISOString();
  if (failed) {
    updateIntegrationRun({
      ...running,
      status: "failed",
      error: failed,
      summary: summary || failed,
      finishedAt,
      updatedAt: finishedAt,
    });
    broadcast({
      type: "integration.run.updated",
      integrationId: run.integrationId,
      runId: run.id,
      status: "failed",
      title: run.title,
      lane: run.lane,
      timestamp: finishedAt,
    });
    return { ok: false, summary: summary || failed, error: failed };
  }

  updateIntegrationRun({
    ...running,
    status: "succeeded",
    summary: summary || "完成",
    resultJson: JSON.stringify({ summary }),
    finishedAt,
    updatedAt: finishedAt,
  });
  broadcast({
    type: "integration.run.updated",
    integrationId: run.integrationId,
    runId: run.id,
    status: "succeeded",
    title: run.title,
    lane: run.lane,
    timestamp: finishedAt,
  });
  return { ok: true, summary: summary || "完成" };
}

export function newWorkItemId(): string {
  return nanoid();
}
