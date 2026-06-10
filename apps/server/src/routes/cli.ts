import { Hono } from "hono";
import { CLI_TEMPLATES, CliProfileSchema } from "@openx/shared";
import { loadSettings, saveSettings } from "../settings-store.js";
import { removeConnectionByExecutorId } from "../connect-store.js";
import { bootstrapConnectProfile, getBootstrapCommand } from "../cli-bootstrap.js";

export const cliRoutes = new Hono();

cliRoutes.get("/templates", (c) => c.json({ templates: CLI_TEMPLATES }));

cliRoutes.post("/profiles", async (c) => {
  const profile = CliProfileSchema.parse(await c.req.json());
  const settings = loadSettings();
  const exists = settings.cliProfiles.some((p) => p.executorId === profile.executorId);
  if (exists) return c.json({ error: "executorId 已存在" }, 409);
  const next = {
    ...settings,
    cliProfiles: [...settings.cliProfiles, profile],
  };
  saveSettings(next);
  return c.json({ profile, settings: next }, 201);
});

cliRoutes.delete("/profiles/:executorId", async (c) => {
  const executorId = c.req.param("executorId");
  if (executorId === "pi" || executorId.startsWith("acp:") || executorId === "auto") {
    return c.json({ error: "系统 CLI 不可删除" }, 400);
  }
  removeConnectionByExecutorId(executorId);
  const settings = loadSettings();
  const next = {
    ...settings,
    cliProfiles: settings.cliProfiles.filter((p) => p.executorId !== executorId),
  };
  saveSettings(next);
  return c.json({ ok: true, settings: next });
});

cliRoutes.get("/profiles/:executorId/bootstrap", (c) => {
  const executorId = c.req.param("executorId");
  const settings = loadSettings();
  const profile = settings.cliProfiles.find((p) => p.executorId === executorId);
  if (!profile) return c.json({ error: "Not found" }, 404);
  const base = new URL(c.req.url).origin;
  return c.json({ command: getBootstrapCommand(profile, base) });
});

cliRoutes.post("/profiles/:executorId/bootstrap", async (c) => {
  const executorId = c.req.param("executorId");
  const settings = loadSettings();
  const profile = settings.cliProfiles.find((p) => p.executorId === executorId);
  if (!profile) return c.json({ error: "Not found" }, 404);
  try {
    const base = new URL(c.req.url).origin;
    const result = bootstrapConnectProfile(profile, base);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});
