import { Hono } from "hono";
import {
  deleteProvider,
  fetchOpenAiCompatibleModels,
  FetchModelsProviderSchema,
  getLlmProvider,
  listLlmProviderTemplates,
  ProviderConfigSchema,
  ProviderSlugSchema,
  resolveProviderApiKey,
  upsertProvider,
  type FetchModelsProvider,
  type ProviderConfig,
} from "@openx/shared";
import {
  getCoachRuntime,
  getPiRuntime,
  testCoachConnection,
  testPiConnection,
} from "@openx/coach";
import { loadSettings, saveSettings, settingsForApi, SettingsRevisionConflictError } from "../settings-store.js";
import { normalizeProviderConfigForUpsert } from "../providers-store.js";
import { getSecretStore } from "../secrets-store.js";

export const modelRoutes = new Hono();

modelRoutes.get("/templates", (c) => {
  return c.json({ templates: listLlmProviderTemplates() });
});

modelRoutes.get("/providers", (c) => {
  const settings = loadSettings();
  return c.json({ providers: settingsForApi(settings).providers ?? {} });
});

modelRoutes.post("/providers", async (c) => {
  try {
    const body = (await c.req.json()) as { slug: string; config: unknown; baseRevision?: number };
    const slug = ProviderSlugSchema.parse(body.slug);
    const config = normalizeProviderConfigForUpsert(
      slug,
      ProviderConfigSchema.parse(body.config),
    );
    const settings = saveSettings(upsertProvider(loadSettings(), slug, config), {
      baseRevision: body.baseRevision,
    });
    const warning = coachProviderWarning(config);
    return c.json({
      slug,
      config: settingsForApi(settings).providers![slug],
      settings: settingsForApi(settings),
      ...(warning ? { warning } : {}),
    });
  } catch (err) {
    if (err instanceof SettingsRevisionConflictError) {
      return c.json(
        { error: "配置版本冲突，请刷新后重试", currentRevision: err.currentRevision },
        409,
      );
    }
    throw err;
  }
});

modelRoutes.put("/providers/:slug", async (c) => {
  try {
    const slug = ProviderSlugSchema.parse(c.req.param("slug"));
    const body = (await c.req.json()) as Record<string, unknown>;
    const baseRevision =
      typeof body.baseRevision === "number" ? body.baseRevision : undefined;
    const { baseRevision: _br, ...configBody } = body;
    const current = loadSettings();
    const existing = current.providers?.[slug];
    const config = normalizeProviderConfigForUpsert(
      slug,
      ProviderConfigSchema.parse(configBody),
      existing,
    );
    const settings = saveSettings(upsertProvider(current, slug, config), {
      baseRevision,
    });
    const warning = coachProviderWarning(config);
    return c.json({
      slug,
      config: settingsForApi(settings).providers![slug],
      settings: settingsForApi(settings),
      ...(warning ? { warning } : {}),
    });
  } catch (err) {
    if (err instanceof SettingsRevisionConflictError) {
      return c.json(
        { error: "配置版本冲突，请刷新后重试", currentRevision: err.currentRevision },
        409,
      );
    }
    throw err;
  }
});

modelRoutes.delete("/providers/:slug", async (c) => {
  try {
    const slug = ProviderSlugSchema.parse(c.req.param("slug"));
    const body = (await c.req.json().catch(() => ({}))) as { baseRevision?: number };
    const settings = saveSettings(deleteProvider(loadSettings(), slug), {
      baseRevision: body.baseRevision,
    });
    return c.json({ ok: true, settings: settingsForApi(settings) });
  } catch (err) {
    if (err instanceof SettingsRevisionConflictError) {
      return c.json(
        { error: "配置版本冲突，请刷新后重试", currentRevision: err.currentRevision },
        409,
      );
    }
    throw err;
  }
});

modelRoutes.get("/status", (c) => {
  const settings = loadSettings();
  const coach = getCoachRuntime(settings);
  const pi = getPiRuntime(settings);
  return c.json({ coach, pi });
});

modelRoutes.post("/fetch-models", async (c) => {
  const settings = loadSettings();
  const body = (await c.req.json().catch(() => ({}))) as {
    slug?: string;
    config?: unknown;
  };

  let config: FetchModelsProvider | undefined;
  if (body.config) {
    config = FetchModelsProviderSchema.parse(body.config);
  } else if (body.slug) {
    const slug = ProviderSlugSchema.parse(body.slug);
    config = settings.providers?.[slug];
    if (!config) {
      return c.json({ ok: false, error: `渠道「${slug}」不存在` }, 404);
    }
  } else {
    return c.json({ ok: false, error: "需要 slug 或 config" }, 400);
  }

  const apiKey =
    resolveProviderApiKey(config) ??
    resolveStoredProviderApiKey(config) ??
    (config.source?.template
      ? getLlmProvider(config.source.template).apiKeyDefault
      : undefined);

  try {
    const models = await fetchOpenAiCompatibleModels(config.api.baseUrl, apiKey);
    return c.json({ ok: true, models, source: "remote" });
  } catch (remoteError) {
    const templateId = config.source?.template;
    if (templateId) {
      const tpl = getLlmProvider(templateId);
      if (tpl.models?.length) {
        return c.json({
          ok: true,
          models: tpl.models.map((id) => ({ id, name: id })),
          source: "template",
          warning:
            remoteError instanceof Error
              ? remoteError.message
              : "远程拉取失败，已回退到模板列表",
        });
      }
    }
    return c.json({
      ok: false,
      error: remoteError instanceof Error ? remoteError.message : "拉取模型失败",
    });
  }
});

modelRoutes.post("/test", async (c) => {
  const settings = loadSettings();
  const body = (await c.req.json().catch(() => ({}))) as {
    ref?: string;
    role?: "coach" | "pi";
    slug?: string;
    config?: unknown;
  };

  if (body.slug && body.config) {
    const slug = ProviderSlugSchema.parse(body.slug);
    const raw = ProviderConfigSchema.parse(body.config);
    const existing = settings.providers?.[slug];
    const config = hydrateProviderConfigForRuntime(
      normalizeProviderConfigForUpsert(slug, raw, existing),
    );
    const warning = coachProviderWarning(config);
    if (warning && (body.role ?? "coach") !== "pi") {
      return c.json({
        ok: false,
        error: warning,
        warning,
        slug,
      });
    }
    const draft = upsertProvider(settings, slug, config);
    const firstModel = Object.keys(config.models).find(
      (id) => !config.models[id]?.disabled,
    );
    const ref = firstModel ? `${slug}/${firstModel}` : undefined;
    if (!ref) {
      return c.json({ ok: false, error: "至少需要一个可用模型" });
    }
    const runtime = getCoachRuntime(draft);
    if (!runtime.ready) {
      return c.json({
        ok: false,
        error: runtime.error ?? "渠道未就绪：请配置 API Key",
        warning: runtime.warning,
        slug,
      });
    }
    const result = await testCoachConnection(draft, undefined, ref);
    return c.json({ ...result, ref, slug, model: runtime.model, baseUrl: runtime.baseUrl });
  }

  const role = body.role ?? "coach";
  const runtime = role === "pi" ? getPiRuntime(settings) : getCoachRuntime(settings);
  if (!runtime.ready) {
    return c.json({
      ok: false,
      error: runtime.error ?? "渠道未就绪：请配置 API Key 或选择 OpenCode Zen",
      warning: runtime.warning,
      ref: runtime.ref,
      slug: runtime.slug,
    });
  }
  const result =
    role === "pi"
      ? await testPiConnection(settings, undefined, body.ref)
      : await testCoachConnection(settings, undefined, body.ref);
  return c.json({
    ...result,
    ref: body.ref ?? runtime.ref,
    slug: runtime.slug,
    model: runtime.model,
    baseUrl: runtime.baseUrl,
  });
});

/** 编辑器留空 apiKey 时，用已存密钥填充运行时草稿（不回写明文到响应） */
function hydrateProviderConfigForRuntime(config: ProviderConfig): ProviderConfig {
  if (config.auth?.apiKey?.trim()) return config;
  const secret = resolveStoredProviderApiKey(config);
  if (!secret) return config;
  return {
    ...config,
    auth: { ...config.auth, apiKey: secret },
  };
}

function coachProviderWarning(config: ProviderConfig): string | undefined {
  const templateId = config.source?.template?.trim();
  if (!templateId) return undefined;
  const def = getLlmProvider(templateId);
  if (def.coachCompatible === false) {
    return def.coachWarning ?? `渠道模板「${templateId}」不兼容 Coach/审查员。`;
  }
  return undefined;
}

function resolveStoredProviderApiKey(config: {
  auth?: { apiKey?: string; env?: string };
}): string | undefined {
  const envVar = config.auth?.env?.trim();
  if (!envVar) return undefined;
  return getSecretStore().get(envVar)?.trim();
}
