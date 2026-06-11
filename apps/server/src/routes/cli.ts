import { Hono } from "hono";
import {
  BootstrapConnectBodySchema,
  CLI_TEMPLATES,
  CliProfileSchema,
  UpdateAcpCliConfigSchema,
} from "@openx/shared";
import { loadSettings, saveSettings } from "../settings-store.js";
import { removeConnectionByExecutorId } from "../connect-store.js";
import {
  bootstrapConnectProfile,
  bootstrapConnectProfileAndWait,
  getBootstrapCommand,
  getConnectBootstrapStatus,
  listConnectBootstrapStatuses,
  syncBootstrapOnlineStatus,
} from "../cli-bootstrap.js";
import { readAcpCliConfig, syncAcpCliFromModelRef } from "../acp-cli-config.js";
import { ensureSystemCliConversation } from "../system-workspace.js";

export const cliRoutes = new Hono();

cliRoutes.get("/system-conversation", (c) => {
  const { project, conversation } = ensureSystemCliConversation();
  return c.json({ project, conversation });
});

cliRoutes.get("/acp-config/:executorId", (c) => {
  const settings = loadSettings();
  const snapshot = readAcpCliConfig(c.req.param("executorId"), settings);
  if (!snapshot) return c.json({ error: "该 CLI 不支持 API 配置" }, 404);
  return c.json({ config: snapshot });
});

cliRoutes.put("/acp-config/:executorId", async (c) => {
  const executorId = c.req.param("executorId");
  const body = UpdateAcpCliConfigSchema.parse(await c.req.json());
  const settings = loadSettings();
  try {
    const { snapshot, settings: next } = syncAcpCliFromModelRef(
      settings,
      executorId,
      body.modelRef,
    );
    saveSettings(next);
    return c.json({ config: snapshot, settings: next });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});

cliRoutes.get("/templates", (c) => c.json({ templates: CLI_TEMPLATES }));

cliRoutes.get("/bootstrap-status", (c) => {
  const statuses = listConnectBootstrapStatuses().map((s) => syncBootstrapOnlineStatus(s.executorId));
  return c.json({ statuses });
});

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

  let bootstrap;
  if (profile.kind === "connect" && settings.autoBootstrapConnect) {
    const base = new URL(c.req.url).origin;
    try {
      bootstrap = await bootstrapConnectProfileAndWait(profile, base);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      bootstrap = {
        error: message,
        status: getConnectBootstrapStatus(profile.executorId),
      };
    }
  }

  return c.json({ profile, settings: next, bootstrap }, 201);
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
  const status = syncBootstrapOnlineStatus(executorId);
  return c.json({
    command: getBootstrapCommand(profile, base),
    status: getConnectBootstrapStatus(executorId) ?? status,
  });
});

cliRoutes.post("/profiles/:executorId/bootstrap", async (c) => {
  const executorId = c.req.param("executorId");
  const settings = loadSettings();
  const profile = settings.cliProfiles.find((p) => p.executorId === executorId);
  if (!profile) return c.json({ error: "Not found" }, 404);

  const rawBody = await c.req.json().catch(() => ({}));
  const body = BootstrapConnectBodySchema.parse(rawBody);

  try {
    const base = new URL(c.req.url).origin;
    const result = body.wait
      ? await bootstrapConnectProfileAndWait(profile, base)
      : bootstrapConnectProfile(profile, base);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 400);
  }
});
