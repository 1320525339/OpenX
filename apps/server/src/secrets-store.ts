/**
 * 密钥存储抽象。
 * 默认 FileCredentialStore（~/.openx/.env，原子写 + 0o600）。
 * 可通过 OPENX_SECRETS_BACKEND=os 尝试 OS 凭据库；不可用时回退文件。
 */
import { existsSync, readFileSync } from "node:fs";
import { mergeDotEnvContent, parseDotEnv } from "@openx/shared";
import { getDotEnvPath } from "./paths.js";
import { atomicWriteText, SENSITIVE_FILE_MODE } from "./atomic-json.js";
import { upsertOpenxDotEnv } from "./openx-dotenv.js";

export type SecretStore = {
  readonly backend: "file" | "os" | "memory";
  get(key: string): string | undefined;
  setMany(entries: Record<string, string>): string[];
};

class FileSecretStore implements SecretStore {
  readonly backend = "file" as const;

  get(key: string): string | undefined {
    if (process.env[key]?.trim()) return process.env[key];
    const path = getDotEnvPath();
    if (!existsSync(path)) return undefined;
    return parseDotEnv(readFileSync(path, "utf8"))[key];
  }

  setMany(entries: Record<string, string>): string[] {
    return upsertOpenxDotEnv(entries);
  }
}

/** 内存后端（测试） */
class MemorySecretStore implements SecretStore {
  readonly backend = "memory" as const;
  private readonly map = new Map<string, string>();

  get(key: string): string | undefined {
    return this.map.get(key) ?? process.env[key];
  }

  setMany(entries: Record<string, string>): string[] {
    const keys: string[] = [];
    for (const [k, v] of Object.entries(entries)) {
      if (!v.trim()) continue;
      this.map.set(k, v);
      process.env[k] = v;
      keys.push(k);
    }
    return keys;
  }
}

/**
 * OS 凭据库占位：当前无原生依赖时回退到文件后端。
 * 后续可接 keytar / Windows DPAPI / macOS Keychain。
 */
class OsSecretStore implements SecretStore {
  readonly backend = "os" as const;
  private readonly fallback = new FileSecretStore();
  private static warned = false;

  private warnOnce(): void {
    if (OsSecretStore.warned) return;
    OsSecretStore.warned = true;
    console.warn(
      "[secrets] OS 凭据库未接入原生模块，回退文件存储（.env）",
    );
  }

  get(key: string): string | undefined {
    this.warnOnce();
    return this.fallback.get(key);
  }

  setMany(entries: Record<string, string>): string[] {
    this.warnOnce();
    return this.fallback.setMany(entries);
  }
}

let active: SecretStore | undefined;

export function getSecretStore(): SecretStore {
  if (active) return active;
  const backend = process.env.OPENX_SECRETS_BACKEND?.trim().toLowerCase();
  if (backend === "memory") {
    active = new MemorySecretStore();
  } else if (backend === "os") {
    active = new OsSecretStore();
  } else {
    active = new FileSecretStore();
  }
  return active;
}

/** 测试用：重置 store 选择 */
export function resetSecretStore(): void {
  active = undefined;
}

/** 将条目写入当前密钥后端（供 providers-store 等调用） */
export function persistSecrets(entries: Record<string, string>): string[] {
  return getSecretStore().setMany(entries);
}

/** 合并 .env 文本（导出工具用） */
export function mergeSecretsDotEnv(
  existing: string,
  entries: Record<string, string>,
): string {
  return mergeDotEnvContent(existing, entries);
}

/** 直接原子写 .env（绕过 store，备份恢复用） */
export function writeDotEnvRaw(content: string): void {
  atomicWriteText(getDotEnvPath(), content.endsWith("\n") ? content : `${content}\n`, {
    mode: SENSITIVE_FILE_MODE,
  });
}
