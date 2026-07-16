import type { DispatchPermissionMode } from "./dispatch-context.js";

/** Pi 默认编码工具（SDK createCodingTools） */
export const PI_CODING_TOOL_NAMES = ["read", "bash", "edit", "write"] as const;

/** Pi 只读工具（SDK createReadOnlyTools） */
export const PI_READ_ONLY_TOOL_NAMES = ["read", "grep", "find", "ls"] as const;

export type ToolRiskClass = "read" | "write" | "shell" | "unknown";

const WRITE_TOOL_RE =
  /^(write|edit|write_file|edit_file|create_file|apply_patch|str_replace|patch|save|touch)$/i;

const SHELL_TOOL_RE = /^(bash|shell|exec|run_terminal_cmd|run_command)$/i;

const READ_TOOL_RE = /^(read|grep|find|ls|glob|search|list_dir|list_files)$/i;

/** 未指定时写前确认（默认拒绝静默放行） */
export function resolveEffectivePermissionMode(
  mode?: DispatchPermissionMode | null,
): DispatchPermissionMode {
  return mode ?? "ask_write";
}

export function classifyToolRisk(toolName: string): ToolRiskClass {
  const name = toolName.trim();
  if (!name) return "unknown";
  if (READ_TOOL_RE.test(name)) return "read";
  if (SHELL_TOOL_RE.test(name)) return "shell";
  if (WRITE_TOOL_RE.test(name)) return "write";
  return "unknown";
}

/**
 * 工具是否允许在当前权限下执行。
 * ask_write 在未提升前与 read_only 相同（仅允许只读工具）。
 * unattended / full 均允许全部工具。
 * 若提供 allowedTools，则与权限基线取交集。
 */
export function permissionAllowsTool(
  mode: DispatchPermissionMode,
  toolName: string,
  allowedTools?: string[] | null,
): boolean {
  const effective = resolveEffectivePermissionMode(mode);
  if (allowedTools?.length) {
    const allow = new Set(allowedTools.map((t) => t.trim().toLowerCase()));
    if (!allow.has(toolName.trim().toLowerCase())) return false;
  }
  if (effective === "full" || effective === "unattended") return true;
  const risk = classifyToolRisk(toolName);
  return risk === "read";
}

export type PiToolSessionPolicy = {
  /**
   * 传给 createAgentSession 的 tools 白名单。
   * undefined = SDK 默认（read/bash/edit/write）。
   */
  createTools?: string[];
  /** 会话创建后立即限制的活跃工具（ask_write） */
  initialActiveTools?: string[];
  /** 写前确认通过后应激活的工具集 */
  elevatedActiveTools?: string[];
};

function intersectTools(
  base: readonly string[],
  allowedTools?: string[] | null,
): string[] {
  if (!allowedTools?.length) return [...base];
  const allow = new Set(allowedTools.map((t) => t.trim().toLowerCase()));
  return base.filter((t) => allow.has(t.toLowerCase()));
}

/** Pi 按派单权限选择工具白名单 / 活跃集 */
export function piToolSessionPolicy(
  mode?: DispatchPermissionMode | null,
  allowedTools?: string[] | null,
): PiToolSessionPolicy {
  const effective = resolveEffectivePermissionMode(mode);
  if (effective === "read_only") {
    return { createTools: intersectTools(PI_READ_ONLY_TOOL_NAMES, allowedTools) };
  }
  if (effective === "ask_write") {
    const elevated = intersectTools(PI_CODING_TOOL_NAMES, allowedTools);
    return {
      // 注册完整编码工具，先只激活只读，确认后再 elevate
      initialActiveTools: intersectTools(["read"], allowedTools),
      elevatedActiveTools: elevated,
    };
  }
  if (allowedTools?.length) {
    return { createTools: [...allowedTools] };
  }
  return {};
}

/** 开发商续跑回复是否应把 ask_write 提升为 full */
export function shouldElevateAskWriteOnResume(userMessage: string): boolean {
  const text = userMessage.trim();
  if (!text) return false;
  if (/拒绝|取消|不要写|不准写|禁止写入|deny|reject|no\b/i.test(text)) {
    return false;
  }
  return true;
}

export function denyToolMessage(
  mode: DispatchPermissionMode,
  toolName: string,
): string {
  const label =
    mode === "read_only"
      ? "只读侦察"
      : mode === "ask_write"
        ? "写前确认（尚未获准写入）"
        : "当前权限";
  return `派单权限为「${label}」，已拦截工具「${toolName}」。如需写入请先获开发商确认并提升权限。`;
}
