import type { RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk";
import {
  createCrewRequestId,
  resolveEffectivePermissionMode,
  type AcpRuntimeId,
  type CrewDirective,
  type DispatchPermissionMode,
} from "@openx/shared";
import type { ExecutorContext } from "@openx/executor-core";

export function parseStoredAcpSessionId(
  crewSessionId: string | undefined,
  runtimeId: AcpRuntimeId,
): string | undefined {
  if (!crewSessionId) return undefined;
  const prefix = `${runtimeId}:`;
  if (crewSessionId.startsWith(prefix)) {
    const sessionPart = crewSessionId.slice(prefix.length);
    return sessionPart || undefined;
  }
  return crewSessionId.includes(":") ? undefined : crewSessionId;
}

function autoApprove(
  params: RequestPermissionRequest,
): RequestPermissionResponse["outcome"] {
  const allow =
    params.options.find((o) => o.kind === "allow_once") ??
    params.options.find((o) => o.kind === "allow_always");
  if (allow) return { outcome: "selected", optionId: allow.optionId };
  return { outcome: "cancelled" };
}

function autoReject(
  params: RequestPermissionRequest,
): RequestPermissionResponse["outcome"] {
  const reject =
    params.options.find((o) => o.kind === "reject_once") ??
    params.options.find((o) => o.kind === "reject_always");
  if (reject) return { outcome: "selected", optionId: reject.optionId };
  return { outcome: "cancelled" };
}

/**
 * 仅接受结构化 selectedOptionId 命中。
 * 禁止自然语言猜测批准（substring / approve regex）。
 */
export function pickPermissionOptionFromForemanReply(
  directive: CrewDirective,
  options: RequestPermissionRequest["options"],
) {
  const selectedId = directive.selectedOptionId?.trim();
  if (!selectedId) return undefined;
  return options.find((o) => o.optionId === selectedId);
}

export async function resolvePermissionViaForeman(
  params: RequestPermissionRequest,
  callbacks: ExecutorContext["callbacks"],
  opts?: {
    permissionMode?: DispatchPermissionMode | null;
    sessionId?: string | null;
  },
): Promise<RequestPermissionResponse["outcome"]> {
  const mode = resolveEffectivePermissionMode(opts?.permissionMode);

  // 只读侦察：一律拒绝写权限请求，禁止静默放行
  if (mode === "read_only") {
    return autoReject(params);
  }

  // 无人值守：跳过工头交互，直接放行
  if (mode === "unattended") {
    return autoApprove(params);
  }

  // 写前确认 / 完全授权：必须经工头结构化选项；无通道或无选项时拒绝
  if (!callbacks.onCrewQuestion || !params.options?.length) {
    return autoReject(params);
  }

  const raw = params as {
    toolCall?: { title?: string };
    title?: string;
  };
  const requestId = createCrewRequestId();
  const question = {
    kind: "question" as const,
    prompt:
      raw.toolCall?.title ??
      raw.title ??
      "施工队请求工头确认操作权限",
    options: params.options.map((o) => ({
      id: o.optionId,
      label: o.name ?? o.kind ?? o.optionId,
    })),
    requestId,
    ...(opts?.sessionId ? { sessionId: opts.sessionId } : {}),
    permissionKind: "write" as const,
  };
  try {
    const directive = await callbacks.onCrewQuestion(question);
    const pick = pickPermissionOptionFromForemanReply(directive, params.options);
    if (pick) return { outcome: "selected", optionId: pick.optionId };
    return autoReject(params);
  } catch {
    return autoReject(params);
  }
}
