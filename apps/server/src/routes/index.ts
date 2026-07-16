import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import {
  SkillBindingsMapSchema,
  SettingsSchema,
  McpServersSchema,
  buildApiCatalogResponse,
} from "@openx/shared";
import {
  countSseEventsAfter,
  listSseEventsAfter,
  getSseEventById,
  listRecentSseEvents,
  MAX_SSE_CATCHUP,
} from "../db.js";
import { getOpenxSkillsDir } from "@openx/shared/skills-path";
import { apiAccessGuard } from "../api-guard.js";
import {
  loadSettings,
  mergeAndSaveSettings,
  patchSettings,
  saveSettings,
  settingsForApi,
  SettingsRevisionConflictError,
} from "../settings-store.js";
import { addSseClient, removeSseClient } from "../sse.js";
import { parseSseLastEventId } from "../sse-resume.js";
import {
  listSkillCatalog,
  loadSkillManifest,
  syncBuiltinSkills,
} from "../skills-service.js";
import { mergedSkillBindings } from "../skills-resolve.js";
import {
  listManagedAgents,
  listManagedAgentsFromRegistry,
} from "../skills-agents.js";
import {
  listAgentCatalog,
  readAgentMd,
  writeAgentMd,
} from "../agents-service.js";
import { getOpenxAgentsDir } from "@openx/shared/agents-path";
import { resolveSystemWorkspaceRoot } from "../system-workspace-path.js";
import {
  getWorkspaceAgentsLinkStatus,
} from "../workspace-agents-link.js";
import {
  ensureWorkspaceSkillsLink,
  getWorkspaceSkillsLinkStatus,
} from "../workspace-skills-link.js";
import { withWorkspaceResolved, normalizeWorkspaceRootForStorage } from "../workspace-path.js";
import { buildIdeOpenUrl, classifyPath, openPathInIde, resolveOpenPath } from "../ide-open.js";
import { readWorkspaceFilePreview } from "../workspace-file-preview.js";
import { pickWorkspaceFolder } from "../workspace-pick.js";
import { detectExecutors } from "../orchestrator.js";
import { listMcpCatalog } from "../dispatch-context.js";

import { goalsRoutes } from "./goals.js";
import { logsRoutes } from "./logs.js";
import { projectsRoutes, conversationsRoutes } from "./projects.js";
import { knowledgeRoutes } from "./knowledge.js";
import { internalRoutes } from "./internal.js";
import { cliRoutes } from "./cli.js";
import { modelRoutes } from "./model.js";
import { coachRoutes } from "./coach.js";
import { connectRoutes } from "./connect.js";
import { islandRoutes } from "./island.js";
import { desktopRoutes } from "./desktop.js";
import { systemRoutes } from "./system.js";
import { bootstrapRoutes } from "./bootstrap.js";
import { operatorRoutes } from "./operator.js";
import { integrationsRoutes } from "./integrations.js";
import { roundtableRoutes } from "./roundtable.js";

export const app = new Hono();

app.use(
  "*",
  cors({
    origin: (origin) => {
      // 开发环境 Vite dev server
      if (origin === "http://localhost:5173" || origin === "http://127.0.0.1:5173") return origin;
      // Tauri 桌面应用 WebView
      if (origin === "http://tauri.localhost" || origin === "https://tauri.localhost") return origin;
      // Tauri 自定义协议
      if (origin?.endsWith(".tauri.localhost")) return origin;
      // file:// 协议（Tauri 或 Electron）
      if (origin === "null" || origin === "file://") return origin;
      return undefined;
    },
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);
app.use("/api/*", apiAccessGuard);

app.get("/api/health", (c) => c.json({ ok: true }));

app.route("/api/bootstrap", bootstrapRoutes);
app.route("/api/operator", operatorRoutes);

app.get("/api/catalog", (c) => c.json(buildApiCatalogResponse()));

app.get("/api/events", (c) => {
  const parsedLastId = parseSseLastEventId(c.req.header("Last-Event-ID"));

  return streamSSE(c, async (stream) => {
    if (parsedLastId !== undefined) {
      if (!getSseEventById(parsedLastId)) {
        await stream.writeSSE({
          event: "gap",
          data: JSON.stringify({ reason: "invalid_last_event_id" }),
        });
        return;
      }
      const pending = countSseEventsAfter(parsedLastId);
      if (pending > MAX_SSE_CATCHUP) {
        await stream.writeSSE({
          event: "gap",
          data: JSON.stringify({ reason: "catchup_truncated", pending }),
        });
        return;
      }
      const missed = listSseEventsAfter(parsedLastId);
      for (const stored of missed) {
        await stream.writeSSE({
          id: String(stored.id),
          event: stored.eventType,
          data: JSON.stringify(stored.payload),
        });
      }
    } else {
      const recent = listRecentSseEvents(80);
      for (const stored of recent) {
        // 首次连接不重放灵动岛，避免一进页面弹出历史通知
        if (stored.eventType === "island.push") continue;
        await stream.writeSSE({
          id: String(stored.id),
          event: stored.eventType,
          data: JSON.stringify(stored.payload),
        });
      }
    }

    const clientId = addSseClient((stored) => {
      stream.writeSSE({
        id: String(stored.id),
        event: stored.eventType,
        data: JSON.stringify(stored.payload),
      }).catch(() => {
        // 客户端已断开但 abort 尚未触发，即时清理避免无效广播
        removeSseClient(clientId);
      });
    });

    // connected 不写 SSE id，避免覆盖浏览器 Last-Event-ID（历史 id=0 会破坏重连游标）
    await stream.writeSSE({
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

app.get("/api/settings", (c) =>
  c.json(settingsForApi(withWorkspaceResolved(loadSettings()))),
);

app.put("/api/settings", async (c) => {
  try {
    const body = (await c.req.json()) as Record<string, unknown>;
    const baseRevision =
      typeof body.baseRevision === "number" ? body.baseRevision : undefined;
    const { baseRevision: _br, ...rest } = body;
    const parsed = SettingsSchema.parse(rest);
    const settings = mergeAndSaveSettings(
      {
        ...parsed,
        workspaceRoot: normalizeWorkspaceRootForStorage(parsed.workspaceRoot),
        systemWorkspaceRoot: parsed.systemWorkspaceRoot?.trim()
          ? normalizeWorkspaceRootForStorage(parsed.systemWorkspaceRoot)
          : parsed.systemWorkspaceRoot,
      },
      { baseRevision },
    );
    return c.json(settingsForApi(withWorkspaceResolved(settings)));
  } catch (err) {
    if (err instanceof SettingsRevisionConflictError) {
      return c.json({ error: err.message, revision: err.currentRevision }, 409);
    }
    throw err;
  }
});

app.patch("/api/settings", async (c) => {
  try {
    const body = (await c.req.json()) as Record<string, unknown>;
    const baseRevision =
      typeof body.baseRevision === "number" ? body.baseRevision : undefined;
    const { baseRevision: _br, ...rest } = body;
    const parsed = SettingsSchema.partial().parse(rest);
    const patch: Partial<typeof parsed> = { ...parsed };
    if (parsed.workspaceRoot !== undefined) {
      patch.workspaceRoot = normalizeWorkspaceRootForStorage(parsed.workspaceRoot);
    }
    if (parsed.systemWorkspaceRoot?.trim()) {
      patch.systemWorkspaceRoot = normalizeWorkspaceRootForStorage(parsed.systemWorkspaceRoot);
    }
    const settings = patchSettings(patch, { baseRevision });
    return c.json(settingsForApi(withWorkspaceResolved(settings)));
  } catch (err) {
    if (err instanceof SettingsRevisionConflictError) {
      return c.json({ error: err.message, revision: err.currentRevision }, 409);
    }
    throw err;
  }
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

app.get("/api/workspace/file-preview", async (c) => {
  const inputPath = c.req.query("path")?.trim();
  if (!inputPath) return c.json({ error: "path 必填" }, 400);

  const settings = loadSettings();
  const result = readWorkspaceFilePreview(inputPath, settings.workspaceRoot);
  if (!result.ok) {
    return c.json(result, result.exists ? 400 : 404);
  }
  return c.json(result);
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

app.get("/api/mcp", (c) => {
  const settings = loadSettings();
  return c.json({ servers: settings.mcpServers ?? [], catalog: listMcpCatalog(settings) });
});

/** 对话 Agent 目录（同步扫描 AGENT.md，不触发 detectExecutors） */
app.get("/api/agents", (c) => {
  const settings = loadSettings();
  const systemDir = resolveSystemWorkspaceRoot(settings);
  return c.json({
    coachAgents: listAgentCatalog(),
    personas: listAgentCatalog(),
    agentsDir: getOpenxAgentsDir(),
    agentsLink: getWorkspaceAgentsLinkStatus(systemDir),
  });
});

app.get("/api/agents/:id", (c) => {
  const id = c.req.param("id");
  const doc = readAgentMd(id === "pi" ? "coder" : id);
  if (!doc) return c.json({ error: "Agent not found" }, 404);
  return c.json({ id, ...doc });
});

app.put("/api/agents/:id", async (c) => {
  const id = c.req.param("id");
  const body = (await c.req.json()) as { content?: string };
  if (!body.content?.trim()) {
    return c.json({ error: "content is required" }, 400);
  }
  try {
    writeAgentMd(id === "pi" ? "coder" : id, body.content);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "Invalid agent id" },
      400,
    );
  }
  const doc = readAgentMd(id === "pi" ? "coder" : id);
  return c.json({ ok: true, id, ...doc });
});

app.put("/api/mcp", async (c) => {
  const body = await c.req.json();
  const servers = McpServersSchema.parse(
    Array.isArray(body) ? body : (body as { servers?: unknown }).servers,
  );
  const settings = loadSettings();
  const next = saveSettings({ ...settings, mcpServers: servers });
  return c.json({ ok: true, servers: next.mcpServers, catalog: listMcpCatalog(next) });
});

app.get("/api/executors", async (c) => {
  const executors = await detectExecutors();
  return c.json({ executors });
});

/** 轻量技能目录（不触发 detectExecutors；在线状态见 GET /api/managed-agents） */
app.get("/api/skills", (c) => {
  const settings = loadSettings();
  const manifest = loadSkillManifest();
  const bindings = mergedSkillBindings(settings);
  const systemDir = resolveSystemWorkspaceRoot(settings);
  return c.json({
    skills: listSkillCatalog(manifest),
    bindings,
    skillsDir: getOpenxSkillsDir(),
    workspaceLink: getWorkspaceSkillsLinkStatus(systemDir),
    agents: listManagedAgentsFromRegistry(settings, bindings),
    coachAgents: listAgentCatalog(),
    agentsDir: getOpenxAgentsDir(),
    agentsLink: getWorkspaceAgentsLinkStatus(systemDir),
  });
});

app.get("/api/managed-agents", async (c) => {
  const settings = loadSettings();
  const executors = await detectExecutors();
  const bindings = mergedSkillBindings(settings);
  return c.json({
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
    const systemDir = resolveSystemWorkspaceRoot(settings);
    const workspaceLink = ensureWorkspaceSkillsLink(systemDir);
    const bindings = mergedSkillBindings(settings);
    return c.json({
      ok: true,
      skills: listSkillCatalog(manifest),
      skillsDir: getOpenxSkillsDir(),
      workspaceLink,
      agents: listManagedAgentsFromRegistry(settings, bindings),
      coachAgents: listAgentCatalog(),
      agentsDir: getOpenxAgentsDir(),
      agentsLink: getWorkspaceAgentsLinkStatus(systemDir),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 502);
  }
});

app.route("/api/projects", projectsRoutes);
app.route("/api/knowledge", knowledgeRoutes);
app.route("/api/conversations", conversationsRoutes);
app.route("/api/roundtable", roundtableRoutes);
app.route("/api/goals", goalsRoutes);
app.route("/api/logs", logsRoutes);
app.route("/api/cli", cliRoutes);
app.route("/api/model", modelRoutes);
app.route("/api/coach", coachRoutes);
app.route("/api/connect", connectRoutes);
app.route("/api/island", islandRoutes);
app.route("/api/desktop", desktopRoutes);
app.route("/api/system", systemRoutes);
app.route("/api/integrations", integrationsRoutes);
app.route("/internal", internalRoutes);
