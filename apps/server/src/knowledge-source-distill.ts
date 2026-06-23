import { upgradeToModelConfig } from "@openx/shared";
import {
  createModel,
  generateCoachText,
  resolveLlmCredentials,
} from "@openx/coach";
import { basename, resolve } from "node:path";
import { loadSettings } from "./settings-store.js";

type DistillResult = { title: string; summary: string };

export function deriveDefaultKnowledgeSourceLabel(
  uri: string,
  kind: "path" | "url",
): string {
  if (kind === "url") {
    const first =
      uri
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.startsWith("http://") || line.startsWith("https://")) ??
      uri.trim();
    try {
      return new URL(first).hostname || first.slice(0, 48);
    } catch {
      return first.slice(0, 48);
    }
  }
  const base = basename(resolve(uri.trim()));
  return base || uri.trim().slice(0, 48);
}

function parseDistillJson(
  text: string,
  fallbackTitle: string,
  fallbackSummary: string,
): DistillResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return { title: fallbackTitle, summary: fallbackSummary };
  }
  try {
    const parsed = JSON.parse(match[0]) as { title?: unknown; summary?: unknown };
    const title =
      typeof parsed.title === "string" && parsed.title.trim()
        ? parsed.title.trim()
        : fallbackTitle;
    const summary =
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : fallbackSummary;
    return { title, summary };
  } catch {
    return { title: fallbackTitle, summary: fallbackSummary };
  }
}

export async function distillKnowledgeSourceContent(opts: {
  uri: string;
  kind: "path" | "url";
  rawText: string;
}): Promise<DistillResult> {
  const fallbackTitle = deriveDefaultKnowledgeSourceLabel(opts.uri, opts.kind);
  const trimmed = opts.rawText.trim();
  if (!trimmed) {
    return { title: fallbackTitle, summary: "" };
  }

  const fallbackSummary = trimmed.slice(0, 6000);
  const settings = loadSettings();
  const creds = resolveLlmCredentials(upgradeToModelConfig(settings), "coach");
  if (!creds) {
    return {
      title: fallbackTitle,
      summary: fallbackSummary,
    };
  }

  const excerpt = trimmed.slice(0, 12_000);
  const system = [
    "你是知识库整理助手。",
    "根据给定资料生成一条知识条目。",
    "只输出 JSON：{\"title\":\"简短中文标题\",\"summary\":\"结构化 Markdown 摘要\"}。",
  ].join("\n");
  const prompt = [
    `来源类型：${opts.kind === "path" ? "本地路径" : "网页"}`,
    `来源：${opts.uri}`,
    "",
    "原始资料：",
    excerpt,
  ].join("\n");

  try {
    const text = await generateCoachText({
      model: createModel(creds),
      system,
      prompt,
      temperature: 0.2,
    });
    return parseDistillJson(text, fallbackTitle, fallbackSummary);
  } catch {
    return {
      title: fallbackTitle,
      summary: fallbackSummary,
    };
  }
}
