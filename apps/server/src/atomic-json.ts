import {
  chmodSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

const SECURE_MODE = 0o600;

/** 原子写入文本文件（tmp → rename），可选收紧权限 */
export function atomicWriteText(
  filePath: string,
  content: string,
  opts?: { mode?: number },
): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const mode = opts?.mode;
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, content, mode !== undefined ? { encoding: "utf8", mode } : "utf8");
  try {
    renameSync(tmp, filePath);
    if (mode !== undefined) {
      try {
        chmodSync(filePath, mode);
      } catch {
        /* Windows 上可能无效，忽略 */
      }
    }
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/** 原子写入 JSON 文件（tmp → rename） */
export function atomicWriteJson(
  filePath: string,
  data: unknown,
  opts?: { mode?: number },
): void {
  atomicWriteText(filePath, `${JSON.stringify(data, null, 2)}\n`, opts);
}

/** 敏感文件默认 mode */
export const SENSITIVE_FILE_MODE = SECURE_MODE;
