import { useEffect, useState } from "react";
import { api } from "../api";
import { pickWorkspaceDirectory } from "../lib/workspace";

/** 与后端默认一致：空或未设置时用 "." */
export function normalizeWorkspaceRoot(path: string): string {
  const trimmed = path.trim();
  return trimmed || ".";
}

export function workspaceInputValue(root?: string, resolvedPath?: string): string {
  if (!root || root.trim() === "" || root === ".") {
    return resolvedPath && resolvedPath !== "." ? resolvedPath : "";
  }
  return root;
}

export function workspaceDisplayPath(value?: string, resolvedPath?: string): string {
  const configured = value?.trim();
  if (!configured || configured === ".") {
    return resolvedPath?.trim() || "选择工作目录";
  }
  return resolvedPath?.trim() || configured;
}

export function isWorkspaceUnset(value?: string, resolvedPath?: string): boolean {
  const configured = value?.trim();
  if (!configured || configured === ".") {
    return !resolvedPath?.trim();
  }
  return false;
}

type Props = {
  value: string;
  /** 服务端解析后的绝对路径，用于侧栏详细展示 */
  resolvedPath?: string;
  onSave: (path: string) => void | Promise<void>;
  /** sidebar：内联目录 + 打开；settings：内联输入，由父级统一保存 */
  variant?: "sidebar" | "settings";
  compact?: boolean;
};

export function WorkspacePicker({
  value,
  resolvedPath,
  onSave,
  variant = "sidebar",
  compact = false,
}: Props) {
  const [draft, setDraft] = useState(workspaceInputValue(value, resolvedPath));
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (variant === "settings") {
      setDraft(workspaceInputValue(value, resolvedPath));
    }
  }, [value, resolvedPath, variant]);

  const commit = async (raw: string) => {
    const normalized = normalizeWorkspaceRoot(raw);
    setSaving(true);
    setHint(null);
    try {
      await onSave(normalized);
    } finally {
      setSaving(false);
    }
  };

  const openWorkspaceFolder = async () => {
    const target = workspaceDisplayPath(value, resolvedPath);
    if (isWorkspaceUnset(value, resolvedPath)) {
      setHint("请先选择工作目录");
      return;
    }
    setHint(null);
    try {
      const res = await api.openInIde(target);
      if (!res.ok) {
        setHint(res.exists === false ? "目录不存在" : "无法在资源管理器中打开");
      }
    } catch {
      setHint("无法在资源管理器中打开");
    }
  };

  const browse = async () => {
    setHint(null);
    const result = await pickWorkspaceDirectory();
    if (result.ok) {
      const next = result.path;
      setDraft(next);
      await commit(next);
      return;
    }
    if (result.reason === "unsupported") {
      setHint(
        variant === "settings"
          ? "无法打开系统目录选择器，请直接粘贴完整路径。"
          : "无法打开系统目录选择器，请在设置页粘贴完整路径。",
      );
    } else if (result.reason === "error") {
      setHint("选择目录失败，请重试。");
    }
  };

  if (variant === "settings") {
    return (
      <div className="workspace-picker settings-inline">
        <input
          className="mech-input workspace-picker-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commit(draft)}
          placeholder="选择或粘贴你的项目文件夹路径"
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit(draft);
          }}
        />
        <button type="button" className="btn" disabled={saving} onClick={() => void browse()}>
          选择目录
        </button>
        {hint && <p className="settings-hint warn workspace-picker-hint-inline">{hint}</p>}
      </div>
    );
  }

  const unset = isWorkspaceUnset(value, resolvedPath);
  const displayPath = workspaceDisplayPath(value, resolvedPath);
  const pathTitle = unset ? "点击选择工作目录" : displayPath;

  return (
    <div className={`workspace-picker-root sidebar-inline${compact ? " compact" : ""}`}>
      <button
        type="button"
        className={`workspace-picker-path${unset ? " unset" : ""}`}
        disabled={saving}
        title={hint ?? pathTitle}
        onClick={() => void browse()}
      >
        <span className="workspace-picker-path-text">{displayPath}</span>
      </button>
      <button
        type="button"
        className="btn primary workspace-picker-open"
        disabled={saving || unset}
        title={unset ? "请先选择工作目录" : "在资源管理器中打开文件夹"}
        onClick={() => void openWorkspaceFolder()}
      >
        打开
      </button>
    </div>
  );
}
