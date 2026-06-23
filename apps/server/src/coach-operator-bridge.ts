import {
  getOperatorCatalog,
  listOperatorApis,
  operatorCallApi,
  proposeOperatorTierUpgrade,
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
import { createCoachKnowledgeGateway } from "./coach-knowledge-bridge.js";

export function createCoachOperatorGateway(
  tier: OperatorTier,
  conversationId?: string,
): OperatorToolGateway {
  const knowledgeGateway = conversationId
    ? createCoachKnowledgeGateway(conversationId)
    : null;
  return {
    tier,
    knowledgeProjectId: knowledgeGateway?.projectId,
    saveKnowledge: knowledgeGateway?.saveEntry,
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
    requestAdminAccess: async (input) => {
      if (tier === "admin") {
        return { kind: "executed", result: { ok: true, alreadyAdmin: true } };
      }
      const outcome = proposeOperatorTierUpgrade("admin", {
        conversationId,
        reason: input.reason,
        summary: input.summary ?? "申请将工头自控权限升级为 admin",
      });
      if (outcome.kind === "pending") {
        return {
          kind: "pending",
          pendingActionId: outcome.pendingActionId,
          action: outcome.action,
        };
      }
      return outcome;
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
