import { basename, isAbsolute, relative, resolve } from "node:path";

export class KnowledgeImportGuardError extends Error {
  readonly code = "KNOWLEDGE_IMPORT_GUARD";

  constructor(message: string) {
    super(message);
    this.name = "KnowledgeImportGuardError";
  }
}

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal", "metadata"]);

function normalizeHost(hostname: string): string {
  const h = hostname.toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) return h.slice(1, -1);
  return h;
}

function parseIPv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums;
}

function isPrivateOrReservedIPv4(host: string): boolean {
  const nums = parseIPv4(host);
  if (!nums) return false;
  if (nums[0] === 0) return true;
  if (nums[0] === 10) return true;
  if (nums[0] === 127) return true;
  if (nums[0] === 169 && nums[1] === 254) return true;
  if (nums[0] === 172 && nums[1]! >= 16 && nums[1]! <= 31) return true;
  if (nums[0] === 192 && nums[1] === 168) return true;
  if (nums[0] === 100 && nums[1]! >= 64 && nums[1]! <= 127) return true;
  return false;
}

function isBlockedIPv6(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true;
  if (h.startsWith("fe80:")) return true;
  return false;
}

export function assertKnowledgeImportUrlAllowed(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new KnowledgeImportGuardError(`无效的 URL：${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new KnowledgeImportGuardError("仅支持 http/https 协议导入");
  }
  const host = normalizeHost(parsed.hostname);
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new KnowledgeImportGuardError(`不允许导入本地或内网地址：${host}`);
  }
  if (host === "169.254.169.254") {
    throw new KnowledgeImportGuardError("不允许导入云元数据地址");
  }
  if (isPrivateOrReservedIPv4(host) || isBlockedIPv6(host)) {
    throw new KnowledgeImportGuardError(`不允许导入本地或内网地址：${host}`);
  }
}

const SENSITIVE_BASENAMES = new Set([
  ".env",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "credentials",
  "secrets.json",
  "secrets.yaml",
  "secrets.yml",
]);

const SENSITIVE_PATH_MARKERS = [
  "/.ssh/",
  "/.aws/",
  "/.gnupg/",
  "\\.ssh\\",
  "\\.aws\\",
  "\\windows\\system32",
  "/etc/shadow",
  "/proc/",
];

function isSensitivePath(absPath: string): boolean {
  const lower = absPath.replace(/\\/g, "/").toLowerCase();
  const base = basename(absPath).toLowerCase();
  if (SENSITIVE_BASENAMES.has(base)) return true;
  if (base.startsWith(".env.")) return true;
  if (base.includes("secret") || base.includes("credential")) return true;
  return SENSITIVE_PATH_MARKERS.some((marker) => lower.includes(marker.replace(/\\/g, "/")));
}

function isPathInsideRoot(candidate: string, root: string): boolean {
  const absCandidate = resolve(candidate);
  const absRoot = resolve(root);
  const rel = relative(absRoot, absCandidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function assertKnowledgeImportPathAllowed(
  pathInput: string,
  opts: { scope: "global" | "user"; workspaceRoot?: string },
): void {
  const abs = resolve(pathInput.trim());
  if (isSensitivePath(abs)) {
    throw new KnowledgeImportGuardError("不允许导入敏感路径或凭据文件");
  }
  if (opts.scope === "user") {
    if (!opts.workspaceRoot?.trim()) {
      throw new KnowledgeImportGuardError("项目工作区未配置，无法导入路径");
    }
    if (!isPathInsideRoot(abs, opts.workspaceRoot)) {
      throw new KnowledgeImportGuardError("项目知识源路径必须位于项目工作区内");
    }
  }
}

export function parseKnowledgeImportUrls(uri: string): string[] {
  return uri
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("http://") || line.startsWith("https://"));
}

export function assertKnowledgeSourceUriAllowed(
  uri: string,
  kind: "path" | "url",
  scope: "global" | "user",
  workspaceRoot?: string,
): void {
  const trimmed = uri.trim();
  if (kind === "url") {
    const urls = parseKnowledgeImportUrls(trimmed);
    if (urls.length === 0) {
      throw new KnowledgeImportGuardError("未找到有效的 http(s) URL");
    }
    for (const url of urls) {
      assertKnowledgeImportUrlAllowed(url);
    }
    return;
  }
  assertKnowledgeImportPathAllowed(trimmed, { scope, workspaceRoot });
}
