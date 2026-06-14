import type { OperatorTier } from "@openx/shared";

export type OperatorToolCallResult = {
  name: string;
  args: unknown;
  result: unknown;
};

export type OperatorActionProposal = {
  pendingActionId: string;
  method: string;
  path: string;
  summary: string;
  reason?: string;
};

export type OperatorToolGateway = {
  tier: OperatorTier;
  listApis: (category?: string) => Promise<unknown>;
  getCatalog: () => Promise<unknown>;
  callApi: (input: {
    method: string;
    path: string;
    pathParams?: Record<string, string>;
    query?: Record<string, string>;
    body?: unknown;
    summary?: string;
    reason?: string;
  }) => Promise<unknown>;
};

export const OPERATOR_TOOL_NAMES = [
  "openx_list_apis",
  "openx_get_catalog",
  "openx_call_api",
] as const;

export type OperatorToolName = (typeof OPERATOR_TOOL_NAMES)[number];
