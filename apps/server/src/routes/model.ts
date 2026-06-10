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
} from "@openx/shared";
import {
  getCoachRuntime,
  getPiRuntime,
  testCoachConnection,
  testPiConnection,
} from "@openx/coach";
import { loadSettings, saveSettings } from "../settings-store.js";

export const modelRoutes = new Hono();

modelRoutes.get("/templates", (c) => {
  return c.json({ templates: listLlmProviderTemplates() });
});

modelRoutes.get("/providers", (c) => {
  const settings = loadSettings();
  return c.json({ providers: settings.providers ?? {} });
});

modelRoutes.post("/providers", async (c) => {
  const body = (await c.req.json()) as { slug: string; config: unknown };
  const slug = ProviderSlugSchema.parse(body.slug);
  const config = ProviderConfigSchema.parse(body.config);
  const settings = saveSettings(upsertProvider(loadSettings(), slug, config));
  return c.json({ slug, config: settings.providers![slug], settings });
});

modelRoutes.put("/providers/:slug", async (c) => {
  const slug = ProviderSlugSchema.parse(c.req.param("slug"));
  const config = ProviderConfigSchema.parse(await c.req.json());
  const settings = saveSettings(upsertProvider(loadSettings(), slug, config));
  return c.json({ slug, config: settings.providers![slug], settings });
});

modelRoutes.delete("/providers/:slug", (c) => {
  const slug = ProviderSlugSchema.parse(c.req.param("slug"));
  const settings = saveSettings(deleteProvider(loadSettings(), slug));
  return c.json({ ok: true, settings });
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
    const config = ProviderConfigSchema.parse(body.config);
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
        error: "渠道未就绪：请配置 API Key",
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
      error: "渠道未就绪：请配置 API Key 或选择 OpenCode Zen",
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
