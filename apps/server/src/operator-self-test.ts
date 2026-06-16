import type { OperatorTier } from "@openx/shared";
import { OPENX_API_CATALOG, buildApiCatalogResponse, buildOperatorPlaybook } from "@openx/shared";
import { app } from "./routes.js";
import { resetDb } from "./db.js";
import { resetOrchestrator } from "./orchestrator.js";
import { resetConnections } from "./connect-store.js";
import { resetOperatorGatewayState, operatorCallApi } from "./operator-gateway.js";
import {
  seedTestProjectAndConversation,
  TEST_CONVERSATION_ID,
  waitForGoalStatus,
  MOCK_PI_TIMEOUT_MS,
} from "./test-helpers.js";
import {
  setInProcessApiHandler,
  callOpenxApi,
  type OpenxApiCallInput,
  type OpenxApiCallResult,
} from "./operator-api-client.js";
import { getServerBaseUrl } from "./server-base-url.js";
import { loadSettings, saveSettings } from "./settings-store.js";

export type SelfTestStepResult = {
  id: string;
  ok: boolean;
  detail: string;
};

export type SelfTestResult = {
  ok: boolean;
  steps: SelfTestStepResult[];
};

const jsonHeaders = { "Content-Type": "application/json" };

async function inProcessReq(method: string, path: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: jsonHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export async function runOperatorSelfTest(opts?: {
  tier?: OperatorTier;
  skipConnect?: boolean;
  /** vitest 隔离模式：重置内存库并使用 app.request */
  isolate?: boolean;
}): Promise<SelfTestResult> {
  const tier = opts?.tier ?? "operator";
  const isolate = opts?.isolate ?? false;
  const steps: SelfTestStepResult[] = [];

  const step = (id: string, ok: boolean, detail: string) => {
    steps.push({ id, ok, detail });
  };

  if (isolate) {
    process.env.OPENX_DB_PATH = ":memory:";
    process.env.OPENX_MOCK_PI = "1";
    resetDb();
    resetConnections();
    resetOrchestrator();
    resetOperatorGatewayState();
    seedTestProjectAndConversation();
    saveSettings({ ...loadSettings(), operatorTier: tier });

    setInProcessApiHandler(async (input: OpenxApiCallInput): Promise<OpenxApiCallResult> => {
      let path = input.path;
      if (input.query) {
        const qs = new URLSearchParams(input.query).toString();
        if (qs) path = `${path}?${qs}`;
      }
      const res = await app.request(path, {
        method: input.method,
        headers:
          input.body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body:
          input.body !== undefined && input.method.toUpperCase() !== "GET"
            ? JSON.stringify(input.body)
            : undefined,
      });
      const text = await res.text();
      let data: unknown = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      return {
        ok: res.ok,
        status: res.status,
        path,
        method: input.method.toUpperCase(),
        data,
        error: res.ok
          ? undefined
          : typeof data === "object" && data && "error" in data
            ? String((data as { error: unknown }).error)
            : res.statusText,
      };
    });
  }

  try {
    if (isolate) {
      const health = await inProcessReq("GET", "/api/health");
      step("catalog_health", health.status === 200, `health ${health.status}`);

      const catalog = buildApiCatalogResponse();
      step(
        "catalog_complete",
        catalog.meta.endpointCount >= OPENX_API_CATALOG.length,
        `endpoints=${catalog.meta.endpointCount}`,
      );

      const projectRes = await inProcessReq("POST", "/api/projects", {
        workspaceDir: process.cwd(),
        name: "self-test",
      });
      const projectBody = (await projectRes.json()) as { project?: { id: string } };
      step(
        "project_create",
        projectRes.status === 201 && Boolean(projectBody.project?.id),
        `status=${projectRes.status}`,
      );

      const convRes = await inProcessReq(
        "POST",
        `/api/projects/${projectBody.project!.id}/conversations`,
        { title: "self-test" },
      );
      const convBody = (await convRes.json()) as { conversation?: { id: string } };
      step(
        "conversation_create",
        convRes.status === 201 && Boolean(convBody.conversation?.id),
        `status=${convRes.status}`,
      );

      const goalPayload = {
        conversationId: convBody.conversation?.id ?? TEST_CONVERSATION_ID,
        userDraft: "self-test ping",
        title: "Self Test",
        acceptance: "完成",
        executionPrompt: "只回复 OK",
        executorId: "pi",
        autoStart: true,
        autoReview: false,
      };
      const goalRes = await inProcessReq("POST", "/api/goals", goalPayload);
      const goalBody = (await goalRes.json()) as {
        goal?: { id: string; status: string };
      };
      step(
        "goal_create",
        goalRes.status === 201 && Boolean(goalBody.goal?.id),
        `status=${goalRes.status} goal=${goalBody.goal?.status}`,
      );

      if (goalBody.goal?.id) {
        try {
          const updated = await waitForGoalStatus(
            goalBody.goal.id,
            ["awaiting_review", "done", "failed"],
            { timeoutMs: MOCK_PI_TIMEOUT_MS },
          );
          if (updated.status === "awaiting_review") {
            const approve = await inProcessReq(
              "POST",
              `/api/goals/${goalBody.goal.id}/approve`,
            );
            step(
              "goal_mock_lifecycle",
              approve.status === 200,
              `awaiting_review → approve ${approve.status}`,
            );
          } else {
            step("goal_mock_lifecycle", updated.status === "done", `final=${updated.status}`);
          }
        } catch (err) {
          step(
            "goal_mock_lifecycle",
            false,
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      const playbook = buildOperatorPlaybook();
      step(
        "operator_playbook",
        playbook.flows.length > 0,
        `flows=${playbook.flows.length}`,
      );
    } else {
      const health = await callOpenxApi({
        baseUrl: getServerBaseUrl(),
        method: "GET",
        path: "/api/health",
      });
      step("catalog_health", health.ok, `health ${health.status}`);

      const catalog = buildApiCatalogResponse();
      step(
        "catalog_complete",
        catalog.meta.endpointCount >= OPENX_API_CATALOG.length,
        `endpoints=${catalog.meta.endpointCount}`,
      );

      const projectRes = await callOpenxApi({
        baseUrl: getServerBaseUrl(),
        method: "POST",
        path: "/api/projects",
        body: { workspaceDir: process.cwd(), name: "self-test" },
      });
      const projectBody = (projectRes.data ?? {}) as { project?: { id: string } };
      step(
        "project_create",
        projectRes.status === 201 && Boolean(projectBody.project?.id),
        `status=${projectRes.status}`,
      );

      const convRes = await callOpenxApi({
        baseUrl: getServerBaseUrl(),
        method: "POST",
        path: `/api/projects/${projectBody.project!.id}/conversations`,
        body: { title: "self-test" },
      });
      const convBody = (convRes.data ?? {}) as { conversation?: { id: string } };
      step(
        "conversation_create",
        convRes.status === 201 && Boolean(convBody.conversation?.id),
        `status=${convRes.status}`,
      );

      const goalRes = await callOpenxApi({
        baseUrl: getServerBaseUrl(),
        method: "POST",
        path: "/api/goals",
        body: {
          conversationId: convBody.conversation?.id ?? TEST_CONVERSATION_ID,
          userDraft: "self-test ping",
          title: "Self Test",
          acceptance: "完成",
          executionPrompt: "只回复 OK",
          executorId: "pi",
          autoStart: true,
          autoReview: false,
        },
      });
      const goalBody = (goalRes.data ?? {}) as { goal?: { id: string; status: string } };
      step(
        "goal_create",
        goalRes.status === 201 && Boolean(goalBody.goal?.id),
        `status=${goalRes.status} goal=${goalBody.goal?.status}`,
      );
      step("goal_mock_lifecycle", true, "skipped live poll (MOCK_PI on server)");

      if (!opts?.skipConnect) {
        const playbook = await callOpenxApi({
          baseUrl: getServerBaseUrl(),
          method: "GET",
          path: "/api/operator/playbook",
        });
        step("operator_playbook", playbook.ok, `playbook ${playbook.status}`);
      }
    }

    const readCall = await operatorCallApi("read", {
      method: "GET",
      path: "/api/executors",
    });
    step(
      "operator_read_get",
      readCall.kind === "executed" && readCall.result.ok,
      readCall.kind === "executed"
        ? `executors ${readCall.result.status}`
        : "unexpected pending",
    );

    const adminCall = await operatorCallApi("admin", {
      method: "PUT",
      path: "/api/settings",
      body: { notifyOnComplete: true },
      summary: "自测：更新 notifyOnComplete",
    });
    step(
      "operator_admin_pending",
      adminCall.kind === "pending",
      adminCall.kind === "pending"
        ? `pendingId=${adminCall.pendingActionId}`
        : "expected pending confirm",
    );
  } finally {
    if (isolate) {
      setInProcessApiHandler(undefined);
      delete process.env.OPENX_DB_PATH;
      delete process.env.OPENX_MOCK_PI;
      resetOrchestrator();
    }
  }

  const ok = steps.every((s) => s.ok);
  return { ok, steps };
}
