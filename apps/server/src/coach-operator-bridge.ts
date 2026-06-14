import {
  getOperatorCatalog,
  listOperatorApis,
  operatorCallApi,
  type OperatorCallInput,
} from "./operator-gateway.js";
import type { OperatorToolGateway } from "@openx/coach";
import type { OperatorTier } from "@openx/shared";
import {
  classifyCoachIntent,
  isAmbiguousTaskMessage,
  mayNeedGoalRefined,
  operatorToolsEnabled,
} from "@openx/shared";

export function createCoachOperatorGateway(
  tier: OperatorTier,
  conversationId?: string,
): OperatorToolGateway {
  return {
    tier,
    listApis: async (category?: string) => listOperatorApis(tier, category),
    getCatalog: async () => getOperatorCatalog(tier),
    callApi: async (input) => {
      const outcome = await operatorCallApi(tier, {
        ...input,
        conversationId,
      } as OperatorCallInput);
      if (outcome.kind === "pending") {
        return {
          kind: "pending",
          pendingActionId: outcome.pendingActionId,
          action: outcome.action,
        };
      }
      return { kind: "executed", result: outcome.result };
    },
  };
}

export function shouldUseOperatorTools(
  tier: OperatorTier,
  message: string,
  opts?: { forceRefine?: boolean; skipRefine?: boolean },
): boolean {
  if (!operatorToolsEnabled(tier)) return false;
  if (opts?.forceRefine || opts?.skipRefine) return false;
  if (isAmbiguousTaskMessage(message)) return false;
  const intent = classifyCoachIntent(message);
  if (intent === "task" || intent === "rework" || mayNeedGoalRefined(message)) {
    return false;
  }
  if (tier === "read") return true;
  return /api|设置|cli|模型|自举|bootstrap|executor|mcp|agent|provider|connect|playbook|自测|operator/i.test(
    message,
  );
}
