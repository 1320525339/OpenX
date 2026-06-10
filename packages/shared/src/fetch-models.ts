export type FetchedModel = {
  id: string;
  name?: string;
};

function modelsEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, "")}/models`;
}

function parseModelsPayload(data: unknown): FetchedModel[] {
  const root = data as {
    data?: { id?: string; name?: string }[];
    models?: { id?: string; name?: string }[];
  };
  const items = Array.isArray(root?.data)
    ? root.data
    : Array.isArray(root?.models)
      ? root.models
      : Array.isArray(data)
        ? (data as { id?: string; name?: string }[])
        : [];

  const models: FetchedModel[] = [];
  for (const item of items) {
    const id = item.id?.trim();
    if (!id) continue;
    const name = item.name?.trim();
    models.push({ id, ...(name && name !== id ? { name } : {}) });
  }
  return models;
}

/** 从 OpenAI 兼容端点 GET /v1/models 拉取模型列表 */
export async function fetchOpenAiCompatibleModels(
  baseUrl: string,
  apiKey?: string,
  options?: { timeoutMs?: number },
): Promise<FetchedModel[]> {
  const timeoutMs = options?.timeoutMs ?? 20_000;
  const headers: Record<string, string> = { Accept: "application/json" };
  const key = apiKey?.trim();
  if (key) headers.Authorization = `Bearer ${key}`;

  const res = await fetch(modelsEndpoint(baseUrl), {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await res.text();
  if (!res.ok) {
    const snippet = text.replace(/\s+/g, " ").slice(0, 180);
    throw new Error(`拉取模型失败 (${res.status})${snippet ? `：${snippet}` : ""}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("拉取模型失败：响应不是有效 JSON");
  }

  const models = parseModelsPayload(data);
  if (models.length === 0) {
    throw new Error("拉取模型失败：响应中无可用模型");
  }
  return models;
}

export function resolveProviderApiKey(config: {
  auth?: { apiKey?: string; env?: string };
}): string | undefined {
  const direct = config.auth?.apiKey?.trim();
  if (direct) return direct;
  const envVar = config.auth?.env?.trim();
  if (envVar) return process.env[envVar]?.trim();
  return undefined;
}
