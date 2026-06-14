import { nanoid } from "nanoid";
import {
  findCatalogEndpoint,
  listApiCatalog,
  buildApiCatalogResponse,
  tierSatisfies,
  type OperatorTier,
} from "@openx/shared";
import {
  callOpenxApi,
  substitutePathParams,
  type OpenxApiCallResult,
} from "./operator-api-client.js";
import { getServerBaseUrl } from "./server-base-url.js";
import { loadSettings } from "./settings-store.js";
import type { Settings } from "@openx/shared";

export type OperatorCallInput = {
  method: string;
  path: string;
  pathParams?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  summary?: string;
  reason?: string;
  conversationId?: string;
};

export type OperatorCallOutcome =
  | { kind: "executed"; result: OpenxApiCallResult }
  | { kind: "pending"; pendingActionId: string; action: PendingOperatorAction };

export type PendingOperatorAction = {
  id: string;
  method: string;
  path: string;
  body?: unknown;
  summary: string;
  reason?: string;
  conversationId?: string;
  createdAt: string;
  status: "pending" | "confirmed" | "dismissed";
  result?: OpenxApiCallResult;
};

const pendingActions = new Map<string, PendingOperatorAction>();
const auditLog: Array<{ ts: string; tier: OperatorTier; method: string; path: string; ok: boolean }> =
  [];

export function resetOperatorGatewayState(): void {
  pendingActions.clear();
  auditLog.length = 0;
}

export function listOperatorApis(tier: OperatorTier, category?: string) {
  if (tier === "off") return [];
  return listApiCatalog({ category, tier });
}

export function getOperatorCatalog(tier: OperatorTier) {
  const res = buildApiCatalogResponse();
  if (tier === "off") {
    return { ...res, endpoints: [] };
  }
  return {
    ...res,
    endpoints: listApiCatalog({ tier }),
  };
}

export function listPendingOperatorActions(conversationId?: string): PendingOperatorAction[] {
  const all = [...pendingActions.values()].filter((a) => a.status === "pending");
  if (!conversationId) return all;
  return all.filter((a) => !a.conversationId || a.conversationId === conversationId);
}

export function getPendingOperatorAction(id: string): PendingOperatorAction | undefined {
  return pendingActions.get(id);
}

function recordAudit(tier: OperatorTier, method: string, path: string, ok: boolean) {
  auditLog.push({ ts: new Date().toISOString(), tier, method, path, ok });
  if (auditLog.length > 500) auditLog.shift();
}

export function getOperatorAuditLog(limit = 50) {
  return auditLog.slice(-limit);
}

function resolveRequestBody(
  method: string,
  path: string,
  body: unknown,
): unknown {
  if (method.toUpperCase() === "PUT" && path === "/api/settings" && body && typeof body === "object") {
    return { ...loadSettings(), ...(body as Partial<Settings>) };
  }
  return body;
}

export async function operatorCallApi(
  tier: OperatorTier,
  input: OperatorCallInput,
  opts?: { skipConfirm?: boolean },
): Promise<OperatorCallOutcome> {
  if (tier === "off") {
    return {
      kind: "executed",
      result: {
        ok: false,
        status: 403,
        path: input.path,
        method: input.method.toUpperCase(),
        error: "operatorTier 为 off，未授权调用 OpenX API",
      },
    };
  }

  const resolvedPath = substitutePathParams(input.path, input.pathParams);
  const endpoint = findCatalogEndpoint(input.method, resolvedPath);

  if (!endpoint) {
    return {
      kind: "executed",
      result: {
        ok: false,
        status: 404,
        path: resolvedPath,
        method: input.method.toUpperCase(),
        error: "未在 API catalog 中找到该端点",
      },
    };
  }

  if (!tierSatisfies(tier, endpoint.minTier)) {
    return {
      kind: "executed",
      result: {
        ok: false,
        status: 403,
        path: resolvedPath,
        method: input.method.toUpperCase(),
        error: `需要 operatorTier >= ${endpoint.minTier}，当前为 ${tier}`,
      },
    };
  }

  if (endpoint.confirmRequired && tier === "admin" && !opts?.skipConfirm) {
    const id = nanoid();
    const action: PendingOperatorAction = {
      id,
      method: input.method.toUpperCase(),
      path: resolvedPath,
      body: input.body,
      summary: input.summary ?? `${input.method} ${resolvedPath}`,
      reason: input.reason,
      conversationId: input.conversationId,
      createdAt: new Date().toISOString(),
      status: "pending",
    };
    pendingActions.set(id, action);
    return { kind: "pending", pendingActionId: id, action };
  }

  const result = await callOpenxApi({
    baseUrl: getServerBaseUrl(),
    method: input.method,
    path: resolvedPath,
    query: input.query,
    body: resolveRequestBody(input.method, resolvedPath, input.body),
  });
  recordAudit(tier, input.method, resolvedPath, result.ok);
  return { kind: "executed", result };
}

export async function confirmOperatorAction(id: string): Promise<PendingOperatorAction | undefined> {
  const action = pendingActions.get(id);
  if (!action || action.status !== "pending") return undefined;

  const result = await callOpenxApi({
    baseUrl: getServerBaseUrl(),
    method: action.method,
    path: action.path,
    body: resolveRequestBody(action.method, action.path, action.body),
  });

  action.status = "confirmed";
  action.result = result;
  recordAudit("admin", action.method, action.path, result.ok);
  return action;
}

export function dismissOperatorAction(id: string): PendingOperatorAction | undefined {
  const action = pendingActions.get(id);
  if (!action || action.status !== "pending") return undefined;
  action.status = "dismissed";
  return action;
}
