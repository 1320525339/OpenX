import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  resolveModelCredentials,
  upgradeToModelConfig,
  type ResolvedModelCredentials,
} from "@openx/shared";
import { getZvecRoot } from "./paths.js";
import { loadSettings } from "./settings-store.js";

const META_FILE = "meta.json";
const EMBED_TIMEOUT_MS = Number.parseInt(
  process.env.OPENX_KNOWLEDGE_EMBED_TIMEOUT_MS ?? "15000",
  10,
);
const MAX_EMBED_CACHE_ENTRIES = 500;
const MAX_EMBED_INPUT_CHARS = 8000;

function setEmbedCache(key: string, vector: number[]): void {
  if (embedCache.size >= MAX_EMBED_CACHE_ENTRIES && !embedCache.has(key)) {
    const oldest = embedCache.keys().next().value;
    if (oldest) embedCache.delete(oldest);
  }
  embedCache.set(key, vector);
}

export type KnowledgeSearchMode = "fts" | "vector" | "hybrid";

type ZvecMeta = {
  embeddingDimension?: number;
  embeddingModelRef?: string;
};

let embeddingAvailable: boolean | undefined;
let embeddingDimensionCache: number | undefined;
const embedCache = new Map<string, number[]>();

function metaPath(): string {
  return join(getZvecRoot(), META_FILE);
}

function readMeta(): ZvecMeta {
  const path = metaPath();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ZvecMeta;
  } catch {
    return {};
  }
}

function writeMeta(patch: Partial<ZvecMeta>): void {
  const root = getZvecRoot();
  mkdirSync(root, { recursive: true });
  const next = { ...readMeta(), ...patch };
  writeFileSync(metaPath(), JSON.stringify(next, null, 2), "utf8");
}

export function resolveKnowledgeSearchMode(): KnowledgeSearchMode {
  const raw = process.env.OPENX_KNOWLEDGE_SEARCH_MODE?.trim().toLowerCase();
  if (raw === "fts" || raw === "vector" || raw === "hybrid") return raw;
  return "hybrid";
}

export function isKnowledgeVectorSearchEnabled(): boolean {
  const mode = resolveKnowledgeSearchMode();
  return mode === "vector" || mode === "hybrid";
}

export function getStoredEmbeddingDimension(): number | undefined {
  if (embeddingDimensionCache) return embeddingDimensionCache;
  const dim = readMeta().embeddingDimension;
  if (typeof dim === "number" && dim > 0) {
    embeddingDimensionCache = dim;
    return dim;
  }
  return undefined;
}

export function getStoredEmbeddingModelRef(): string | undefined {
  const ref = readMeta().embeddingModelRef;
  return typeof ref === "string" && ref.trim() ? ref : undefined;
}

export function getCurrentKnowledgeEmbeddingModelRef(): string | undefined {
  const creds = resolveCoachEmbeddingCredentials();
  return creds ? `${creds.slug}/${creds.modelId}` : undefined;
}

export function hasKnowledgeEmbeddingModelChanged(): boolean {
  const stored = getStoredEmbeddingModelRef();
  const current = getCurrentKnowledgeEmbeddingModelRef();
  return Boolean(stored && current && stored !== current);
}

export function resetKnowledgeEmbeddingForTests(): void {
  embeddingAvailable = undefined;
  embeddingDimensionCache = undefined;
  embedCache.clear();
}

function resolveCoachEmbeddingCredentials(): ResolvedModelCredentials | null {
  const settings = upgradeToModelConfig(loadSettings());
  const ref = settings.model?.coach?.trim();
  if (!ref) return null;
  return resolveModelCredentials(settings, ref);
}

function cacheKey(text: string, creds: ResolvedModelCredentials): string {
  return createHash("sha256")
    .update(`${creds.baseUrl}|${creds.model}|${text}`, "utf8")
    .digest("hex");
}

async function callEmbeddingsApi(
  creds: ResolvedModelCredentials,
  input: string,
): Promise<number[] | null> {
  const base = creds.baseUrl.replace(/\/+$/, "");
  const url = `${base}/embeddings`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${creds.apiKey}`,
      },
      body: JSON.stringify({
        model: creds.model,
        input: input.slice(0, MAX_EMBED_INPUT_CHARS),
      }),
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const embedding = body.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) return null;
    return embedding;
  } catch {
    return null;
  }
}

function persistEmbeddingDimension(
  dimension: number,
  creds: ResolvedModelCredentials,
): void {
  embeddingDimensionCache = dimension;
  writeMeta({
    embeddingDimension: dimension,
    embeddingModelRef: `${creds.slug}/${creds.modelId}`,
  });
}

/** 探测当前 Coach 模型是否支持 embedding */
export async function probeKnowledgeEmbedding(opts?: { acceptModelChange?: boolean }): Promise<boolean> {
  if (embeddingAvailable === true) return true;
  if (embeddingAvailable === false && !opts?.acceptModelChange) return false;
  if (!isKnowledgeVectorSearchEnabled()) {
    embeddingAvailable = false;
    return false;
  }
  const creds = resolveCoachEmbeddingCredentials();
  if (!creds) {
    embeddingAvailable = false;
    return false;
  }
  const storedModelRef = getStoredEmbeddingModelRef();
  const currentModelRef = `${creds.slug}/${creds.modelId}`;
  if (storedModelRef && storedModelRef !== currentModelRef && !opts?.acceptModelChange) {
    embeddingAvailable = false;
    return false;
  }
  const vector = await callEmbeddingsApi(creds, "OpenX knowledge embedding probe");
  if (!vector) {
    embeddingAvailable = false;
    return false;
  }
  persistEmbeddingDimension(vector.length, creds);
  embeddingAvailable = true;
  return true;
}

export function isKnowledgeEmbeddingAvailable(): boolean {
  return embeddingAvailable === true && Boolean(getStoredEmbeddingDimension());
}

/** 将知识文本转为向量；失败返回 null（调用方回退 FTS） */
export async function embedKnowledgeText(
  text: string,
  opts?: { acceptModelChange?: boolean },
): Promise<number[] | null> {
  const trimmed = text.trim();
  if (!trimmed || !isKnowledgeVectorSearchEnabled()) return null;

  const creds = resolveCoachEmbeddingCredentials();
  if (!creds) return null;

  const key = cacheKey(trimmed, creds);
  const cached = embedCache.get(key);
  if (cached) return cached;

  const ok = await probeKnowledgeEmbedding(opts);
  if (!ok) return null;

  const vector = await callEmbeddingsApi(creds, trimmed);
  if (!vector) return null;

  const storedDim = getStoredEmbeddingDimension();
  if (storedDim && storedDim !== vector.length) {
    embeddingAvailable = false;
    return null;
  }
  if (!storedDim) {
    persistEmbeddingDimension(vector.length, creds);
    embeddingAvailable = true;
  }

  setEmbedCache(key, vector);
  return vector;
}

export function truncateKnowledgeEmbedInput(text: string): string {
  const lines = text.trim().split("\n").filter(Boolean);
  return lines.slice(0, 32).join("\n").slice(0, MAX_EMBED_INPUT_CHARS);
}
