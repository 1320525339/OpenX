import { Hono } from "hono";
import {
  refineGoal,
  coachChatReply,
  getCoachRuntime,
  testCoachConnection,
} from "@openx/coach";
import {
  RefineInputSchema,
  CoachChatInputSchema,
  listLlmProviderTemplates,
} from "@openx/shared";
import { saveCoachMessage, listCoachMessages } from "../db.js";
import { loadSettings } from "../settings-store.js";
import { broadcast } from "../sse.js";
import { buildCoachChatContext } from "../coach-context.js";
import { listSkillCatalog, loadSkillManifest } from "../skills-service.js";

export const coachRoutes = new Hono();

coachRoutes.get("/providers", (c) => {
  return c.json({ providers: listLlmProviderTemplates() });
});

coachRoutes.get("/status", (c) => {
  const settings = loadSettings();
  const runtime = getCoachRuntime(settings);
  return c.json({
    ...runtime,
    providerId: runtime.slug,
    baseUrl: runtime.baseUrl,
  });
});

coachRoutes.post("/test", async (c) => {
  const settings = loadSettings();
  const runtime = getCoachRuntime(settings);
  if (!runtime.ready) {
    return c.json({
      ok: false,
      error: "渠道未就绪：请配置 API Key 或选择 OpenCode Zen",
      providerId: runtime.slug,
    });
  }
  const result = await testCoachConnection(settings);
  return c.json({
    ...result,
    providerId: runtime.slug,
    model: runtime.model,
    baseUrl: runtime.baseUrl,
  });
});

coachRoutes.post("/refine", async (c) => {
  const input = RefineInputSchema.parse(await c.req.json());
  const settings = loadSettings();
  const { refined, llmError, quotaExceeded } = await refineGoal(
    input,
    settings,
    settings.defaultConstraints,
  );
  return c.json({
    ...refined,
    meta: { llmError, quotaExceeded },
  });
});

coachRoutes.get("/messages", (c) => {
  const goalId = c.req.query("goalId");
  const messages = listCoachMessages(goalId ?? undefined);
  return c.json({ messages });
});

coachRoutes.post("/chat", async (c) => {
  try {
    const input = CoachChatInputSchema.parse(await c.req.json());
    const settings = loadSettings();
    const goalKey = input.goalId ?? null;
    const chatHistory = listCoachMessages(goalKey, 24).map((m) => ({
      role: m.role,
      text: m.text,
    }));
    saveCoachMessage(goalKey, "user", input.message);
    const ctx = buildCoachChatContext(input.goalId);
    if (input.skillIds?.length) {
      const catalog = listSkillCatalog(loadSkillManifest());
      ctx.enabledSkills = catalog
        .filter((s) => input.skillIds!.includes(s.id))
        .map((s) => ({ id: s.id, name: s.name, desc: s.desc }));
    }
    const { message, refined, llmError, quotaExceeded } = await coachChatReply(
      input.message,
      ctx,
      settings,
      settings.defaultConstraints,
      undefined,
      chatHistory,
    );
    saveCoachMessage(goalKey, "coach", message);
    const payload = {
      type: "coach.reply" as const,
      message,
      refined,
      meta: { llmError, quotaExceeded },
      timestamp: new Date().toISOString(),
    };
    broadcast(payload);
    return c.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[coach] /chat failed:", err);
    return c.json({ error: msg }, 500);
  }
});
