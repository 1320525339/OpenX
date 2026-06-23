import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { resolveHighlightLang } from "./code-highlight-lang";

// Re-export for backward compatibility
export { highlightLangFromPath, resolveHighlightLang } from "./code-highlight-lang";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("go", go);
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const HL_CACHE_MAX = 200;

function hashCode(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h;
}

interface CacheEntry {
  code: string;
  html: string;
}

const hlCache = new Map<number, CacheEntry>();

function cacheGet(code: string, lang: string): string | null {
  const key = hashCode(`${lang}\0${code}`);
  const entry = hlCache.get(key);
  if (!entry || entry.code !== code) return null;
  hlCache.delete(key);
  hlCache.set(key, entry);
  return entry.html;
}

function cachePut(code: string, lang: string, html: string): void {
  const key = hashCode(`${lang}\0${code}`);
  hlCache.set(key, { code, html });
  while (hlCache.size > HL_CACHE_MAX) {
    const oldest = hlCache.keys().next().value;
    if (oldest === undefined) break;
    hlCache.delete(oldest);
  }
}

/** 返回 highlight.js token HTML；未知语言时转义纯文本（带 LRU，借鉴 Reasonix） */
export function highlightToHtml(code: string, lang?: string): string {
  const resolved = resolveHighlightLang(lang);
  if (!resolved) return escapeHtml(code);
  const cached = cacheGet(code, resolved);
  if (cached !== null) return cached;
  try {
    const html = hljs.highlight(code, { language: resolved, ignoreIllegals: true }).value;
    cachePut(code, resolved, html);
    return html;
  } catch {
    return escapeHtml(code);
  }
}

/** 测试用：清空 highlight LRU */
export function clearHighlightCacheForTests(): void {
  hlCache.clear();
}
