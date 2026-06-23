import { languageFromPath } from "@openx/shared";

/**
 * 来源：vendors/reasonix/desktop/frontend/src/lib/lang.ts
 * 无 hljs 依赖，供 ToolCard / ToolDiffView 推断语言。
 */
export const LANG_ALIASES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  py: "python",
  rs: "rust",
  yml: "yaml",
  html: "xml",
  md: "markdown",
};

const EXT: Record<string, string> = {
  go: "go",
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  py: "python",
  rs: "rust",
  html: "xml",
  xml: "xml",
  css: "css",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  java: "java",
  sql: "sql",
};

export const HIGHLIGHT_LANGS = new Set([
  "bash",
  "css",
  "go",
  "java",
  "javascript",
  "json",
  "markdown",
  "python",
  "rust",
  "sql",
  "typescript",
  "xml",
  "yaml",
]);

export function extToLang(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "";
  return EXT[path.slice(dot + 1).toLowerCase()] ?? "";
}

export function resolveHighlightLang(lang?: string): string {
  if (!lang) return "";
  const normalized = LANG_ALIASES[lang.toLowerCase()] ?? lang.toLowerCase();
  return HIGHLIGHT_LANGS.has(normalized) ? normalized : "";
}

export function highlightLangFromPath(path?: string): string | undefined {
  if (!path) return undefined;
  const fromPath = languageFromPath(path) || extToLang(path);
  if (!fromPath) return undefined;
  const resolved = resolveHighlightLang(fromPath);
  return resolved || undefined;
}
