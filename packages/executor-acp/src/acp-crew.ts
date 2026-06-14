import type { RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk";
import type { AcpRuntimeId, CrewDirective } from "@openx/shared";
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

/** 从工头自然语言回复中匹配权限选项 */
export function pickPermissionOptionFromForemanReply(
  directive: CrewDirective,
  options: RequestPermissionRequest["options"],
) {
  if (directive.selectedOptionId) {
    const byId = options.find((o) => o.optionId === directive.selectedOptionId);
    if (byId) return byId;
  }
  const msg = directive.message;
  for (const o of options) {
    const label = o.name ?? o.kind ?? o.optionId;
    if (msg.includes(label) || msg.includes(o.optionId)) return o;
  }
  if (/允许|批准|可以|继续|approve/i.test(msg)) {
    return (
      options.find((o) => o.kind === "allow_once") ??
      options.find((o) => o.kind === "allow_always")
    );
  }
  if (/拒绝|取消|deny|reject/i.test(msg)) {
    return options.find((o) => o.kind === "reject_once" || o.kind === "reject_always");
  }
  return undefined;
}

export async function resolvePermissionViaForeman(
  params: RequestPermissionRequest,
  callbacks: ExecutorContext["callbacks"],
): Promise<RequestPermissionResponse["outcome"]> {
  if (!callbacks.onCrewQuestion || !params.options?.length) {
    return autoApprove(params);
  }
  const raw = params as {
    toolCall?: { title?: string };
    title?: string;
  };
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
  };
  try {
    const directive = await callbacks.onCrewQuestion(question);
    const pick = pickPermissionOptionFromForemanReply(directive, params.options);
    if (pick) return { outcome: "selected", optionId: pick.optionId };
    return autoApprove(params);
  } catch {
    return autoApprove(params);
  }
}
