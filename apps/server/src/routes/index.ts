import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { SkillBindingsMapSchema } from "@openx/shared";
import {
  countSseEventsAfter,
  listSseEventsAfter,
  getSseEventById,
  listRecentSseEvents,
  MAX_SSE_CATCHUP,
} from "../db.js";
import { getOpenxSkillsDir } from "@openx/shared/skills-path";
import { browserCsrfGuard } from "../api-guard.js";
import { loadSettings, saveSettings } from "../settings-store.js";
import { addSseClient, removeSseClient } from "../sse.js";
import {
  listSkillCatalog,
  loadSkillManifest,
  syncBuiltinSkills,
} from "../skills-service.js";
import { mergedSkillBindings } from "../skills-resolve.js";
import { listManagedAgents } from "../skills-agents.js";
import {
  ensureWorkspaceSkillsLink,
  getWorkspaceSkillsLinkStatus,
} from "../workspace-skills-link.js";
import { withWorkspaceResolved, normalizeWorkspaceRootForStorage } from "../workspace-path.js";
import { buildIdeOpenUrl, classifyPath, openPathInIde, resolveOpenPath } from "../ide-open.js";
import { pickWorkspaceFolder } from "../workspace-pick.js";
import { SettingsSchema } from "@openx/shared";
import { detectExecutors } from "../orchestrator.js";

import { goalsRoutes } from "./goals.js";
import { internalRoutes } from "./internal.js";
import { cliRoutes } from "./cli.js";
import { modelRoutes } from "./model.js";
import { coachRoutes } from "./coach.js";
import { connectRoutes } from "./connect.js";

export const app = new Hono();

app.use(
  "*",
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);
app.use("/api/*", browserCsrfGuard);

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/events", (c) => {
  const lastEventIdHeader = c.req.header("Last-Event-ID");
  const parsedLastId = lastEventIdHeader ? Number.parseInt(lastEventIdHeader, 10) : undefined;

  return streamSSE(c, async (stream) => {
    if (parsedLastId !== undefined && !Number.isNaN(parsedLastId)) {
      if (!getSseEventById(parsedLastId)) {
        await stream.writeSSE({
          event: "gap",
          data: JSON.stringify({ reason: "invalid_last_event_id" }),
        });
      } else {
        const pending = countSseEventsAfter(parsedLastId);
        if (pending > MAX_SSE_CATCHUP) {
          await stream.writeSSE({
            event: "gap",
            data: JSON.stringify({ reason: "catchup_truncated", pending }),
          });
        } else {
          const missed = listSseEventsAfter(parsedLastId);
          for (const stored of missed) {
            await stream.writeSSE({
              id: String(stored.id),
              event: stored.eventType,
              data: JSON.stringify(stored.payload),
            });
          }
        }
      }
    } else {
      const recent = listRecentSseEvents(80);
      for (const stored of recent) {
        await stream.writeSSE({
          id: String(stored.id),
          event: stored.eventType,
          data: JSON.stringify(stored.payload),
        });
      }
    }

    const clientId = addSseClient((stored) => {
      void stream.writeSSE({
        id: String(stored.id),
        event: stored.eventType,
        data: JSON.stringify(stored.payload),
      });
    });

    await stream.writeSSE({
      id: "0",
      event: "connected",
      data: JSON.stringify({ type: "connected", clientId }),
    });

    await new Promise<void>((resolve) => {
      c.req.raw.signal.addEventListener("abort", () => {
        removeSseClient(clientId);
        resolve();
      });
    });
  });
});

app.get("/api/settings", (c) => c.json(withWorkspaceResolved(loadSettings())));

app.put("/api/settings", async (c) => {
  const body = await c.req.json();
  const parsed = SettingsSchema.parse(body);
  const settings = saveSettings({
    ...parsed,
    workspaceRoot: normalizeWorkspaceRootForStorage(parsed.workspaceRoot),
  });
  ensureWorkspaceSkillsLink(settings.workspaceRoot);
  return c.json(withWorkspaceResolved(settings));
});

app.post("/api/workspace/pick", async (c) => {
  const result = await pickWorkspaceFolder();
  if (result.ok) {
    return c.json({ ok: true as const, path: normalizeWorkspaceRootForStorage(result.path) });
  }
  if (result.reason === "unsupported") {
    return c.json({ ok: false as const, reason: "unsupported" }, 501);
  }
  return c.json({
    ok: false as const,
    reason: result.reason,
    message: result.message,
  });
});

app.post("/api/workspace/open-in-ide", async (c) => {
  const body = (await c.req.json()) as { path?: string };
  const inputPath = body.path?.trim();
  if (!inputPath) return c.json({ error: "path 必填" }, 400);

  const settings = loadSettings();
  const absolutePath = resolveOpenPath(inputPath, settings.workspaceRoot);
  const kind = classifyPath(absolutePath);
  const ideUrl = buildIdeOpenUrl(absolutePath, kind) ?? undefined;
  const opened = await openPathInIde(absolutePath);

  return c.json({
    ok: opened.ok,
    absolutePath,
    kind,
    ideUrl,
    exists: opened.exists,
    command: opened.command,
    method: opened.method,
  });
});

app.get("/api/executors", async (c) => {
  const executors = await detectExecutors();
  return c.json({ executors });
});

app.get("/api/skills", async (c) => {
  const settings = loadSettings();
  const manifest = loadSkillManifest();
  const executors = await detectExecutors();
  const bindings = mergedSkillBindings(settings);
  return c.json({
    skills: listSkillCatalog(manifest),
    bindings,
    skillsDir: getOpenxSkillsDir(),
    workspaceLink: getWorkspaceSkillsLinkStatus(settings.workspaceRoot),
    agents: listManagedAgents(executors, settings.cliProfiles ?? [], bindings),
  });
});

app.put("/api/skills/bindings", async (c) => {
  const bindings = SkillBindingsMapSchema.parse(await c.req.json());
  const settings = loadSettings();
  const next = saveSettings({ ...settings, skillBindings: bindings });
  return c.json({ ok: true, bindings: mergedSkillBindings(next), settings: next });
});

app.post("/api/skills/sync", async (c) => {
  try {
    const manifest = await syncBuiltinSkills(true);
    const settings = loadSettings();
    const workspaceLink = ensureWorkspaceSkillsLink(settings.workspaceRoot);
    const executors = await detectExecutors();
    const bindings = mergedSkillBindings(settings);
    return c.json({
      ok: true,
      skills: listSkillCatalog(manifest),
      skillsDir: getOpenxSkillsDir(),
      workspaceLink,
      agents: listManagedAgents(executors, settings.cliProfiles ?? [], bindings),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 502);
  }
});

app.route("/api/goals", goalsRoutes);
app.route("/api/cli", cliRoutes);
app.route("/api/model", modelRoutes);
app.route("/api/coach", coachRoutes);
app.route("/api/connect", connectRoutes);
app.route("/internal", internalRoutes);
