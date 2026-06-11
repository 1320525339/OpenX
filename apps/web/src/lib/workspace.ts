type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: () => Promise<{ name: string }>;
};

import { getApiBase } from "./api-base";

export function workspaceDisplayLabel(root?: string): string {
  if (!root || root.trim() === "" || root === ".") {
    return "选择工作目录";
  }
  const normalized = root.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0) return root;
  if (parts.length === 1) return parts[0]!;
  return parts[parts.length - 1]!;
}

export async function pickWorkspaceDirectory(): Promise<
  { ok: true; path: string } | { ok: false; reason: "unsupported" | "aborted" | "error" }
> {
  try {
    const res = await fetch(`${getApiBase()}/api/workspace/pick`, { method: "POST" });
    if (res.ok) {
      const data = (await res.json()) as
        | { ok: true; path: string }
        | { ok: false; reason?: string };
      if (data.ok && data.path?.trim()) {
        return { ok: true, path: data.path.trim() };
      }
      if (!data.ok && data.reason === "aborted") {
        return { ok: false, reason: "aborted" };
      }
      return { ok: false, reason: "error" };
    }
    if (res.status === 501) {
      return pickWorkspaceDirectoryFromBrowser();
    }
    return { ok: false, reason: "error" };
  } catch {
    return pickWorkspaceDirectoryFromBrowser();
  }
}

async function pickWorkspaceDirectoryFromBrowser(): Promise<
  { ok: true; path: string } | { ok: false; reason: "unsupported" | "aborted" | "error" }
> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) {
    return { ok: false, reason: "unsupported" };
  }

  try {
    await picker();
    // 浏览器 API 无法返回完整路径，避免只保存文件夹名导致路径错位
    return { ok: false, reason: "unsupported" };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, reason: "aborted" };
    }
    return { ok: false, reason: "error" };
  }
}
