export type PathKind = "file" | "directory";

export function inferPathKind(path: string): PathKind {
  if (/[\\/]$/.test(path)) return "directory";
  const base = path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path;
  return base.includes(".") && !base.endsWith(".") ? "file" : "directory";
}

/** 仅文件可回退 cursor://；文件夹必须走服务端资源管理器 */
export function buildIdeOpenUrl(
  absPath: string,
  kind: PathKind,
  line?: number,
): string | null {
  if (kind === "directory") return null;
  const file = absPath.replace(/\\/g, "/");
  const suffix = line && line > 0 ? `:${line}` : "";
  return `cursor://file/${file}${suffix}`;
}

export function openIdeFileUrl(url: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
