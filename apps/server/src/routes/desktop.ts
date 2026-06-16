import { Hono } from "hono";
import {
  OxspSlotCommandBodySchema,
  OxspSlotCreateBodySchema,
  PinDesktopScopeSchema,
  parsePinDesktopWorkspace,
  OxspSlotCatalogSchema,
} from "@openx/shared";
import { broadcast } from "../sse.js";
import {
  createOxspSlot,
  getDesktopBundle,
  listSlotSnapshots,
  removeOxspSlotInstance,
  runOxspSlotCommand,
  syncDesktopFromClient,
} from "../desktop-service.js";
import {
  buildBrowserDesktopContext,
  pinDesktopScopeForConversation,
} from "../browser-desktop-context.js";
import { browserRoutes } from "./browser.js";

export const desktopRoutes = new Hono();
desktopRoutes.route("/browser", browserRoutes);

function parseScope(raw: string | undefined) {
  return PinDesktopScopeSchema.parse(raw ?? "console");
}

function parseRevision(raw: string | null | undefined): number | undefined {
  if (raw == null || raw === "") return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? undefined : n;
}

function emitDesktopChanged(scope: string, revision: number) {
  broadcast({
    type: "desktop.layout_changed",
    scope: scope as "console" | "conversation",
    revision,
    timestamp: new Date().toISOString(),
  });
}

/** 工头 LLM 可见的浏览器快照预览 */
desktopRoutes.get("/browser-context", async (c) => {
  const scope = parseScope(c.req.query("scope"));
  const conversationId = c.req.query("conversationId");
  const resolvedScope = conversationId
    ? pinDesktopScopeForConversation(conversationId)
    : scope;
  const text = await buildBrowserDesktopContext(resolvedScope);
  return c.json({ ok: true, scope: resolvedScope, text: text ?? null });
});

/** slot_list：布局 + catalog + 模板 */
desktopRoutes.get("/slots", (c) => {
  const scope = parseScope(c.req.query("scope"));
  const bundle = getDesktopBundle(scope);
  return c.json({
    revision: bundle.revision,
    scope: bundle.scope,
    workspace: bundle.workspace,
    catalog: bundle.catalog,
    templates: bundle.templates,
    pinnedWidgets: bundle.pinnedWidgets,
    snapshots: listSlotSnapshots(scope),
  });
});

/** slot_create */
desktopRoutes.post("/slots", async (c) => {
  const scope = parseScope(c.req.query("scope"));
  const baseRevision = parseRevision(c.req.header("x-openx-desktop-revision"));
  const body = OxspSlotCreateBodySchema.parse(await c.req.json());
  try {
    const { bundle, slotId, widgetId } = createOxspSlot(scope, body, baseRevision);
    emitDesktopChanged(scope, bundle.revision);
    return c.json({ ok: true, slotId, widgetId, ...bundle });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("DESKTOP_REVISION_CONFLICT:")) {
      return c.json({ ok: false, error: "revision_conflict", revision: msg.split(":")[1] }, 409);
    }
    if (msg === "SLOT_PIN_FAILED") {
      return c.json({ ok: false, error: "pin_failed" }, 400);
    }
    throw err;
  }
});

/** slot_command */
desktopRoutes.post("/slots/:slotId/command", async (c) => {
  const scope = parseScope(c.req.query("scope"));
  const slotId = c.req.param("slotId");
  const baseRevision = parseRevision(c.req.header("x-openx-desktop-revision"));
  const body = OxspSlotCommandBodySchema.parse(await c.req.json());
  try {
    const { bundle, result } = await runOxspSlotCommand(scope, slotId, body, baseRevision);
    emitDesktopChanged(scope, bundle.revision);
    return c.json({ ok: true, result, ...bundle });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("DESKTOP_REVISION_CONFLICT:")) {
      return c.json({ ok: false, error: "revision_conflict", revision: msg.split(":")[1] }, 409);
    }
    if (msg === "SLOT_NOT_FOUND") return c.json({ ok: false, error: "not_found" }, 404);
    if (msg === "SLOT_PIN_FAILED") return c.json({ ok: false, error: "pin_failed" }, 400);
    if (msg === "INVALID_URL") return c.json({ ok: false, error: "invalid_url" }, 400);
    if (msg === "NOT_BROWSER_SLOT") return c.json({ ok: false, error: "not_browser_slot" }, 400);
    if (msg === "COORDS_REQUIRED") return c.json({ ok: false, error: "coords_required" }, 400);
    if (msg === "TEXT_REQUIRED") return c.json({ ok: false, error: "text_required" }, 400);
    throw err;
  }
});

desktopRoutes.delete("/slots/:slotId", async (c) => {
  const scope = parseScope(c.req.query("scope"));
  const slotId = c.req.param("slotId");
  const baseRevision = parseRevision(c.req.header("x-openx-desktop-revision"));
  try {
    const bundle = await removeOxspSlotInstance(scope, slotId, baseRevision);
    emitDesktopChanged(scope, bundle.revision);
    return c.json({ ok: true, ...bundle });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("DESKTOP_REVISION_CONFLICT:")) {
      return c.json({ ok: false, error: "revision_conflict", revision: msg.split(":")[1] }, 409);
    }
    throw err;
  }
});

/** Web 端上行同步（localStorage → server） */
desktopRoutes.put("/state", async (c) => {
  const scope = parseScope(c.req.query("scope"));
  const baseRevision = parseRevision(c.req.header("x-openx-desktop-revision"));
  const body = (await c.req.json()) as {
    workspace?: unknown;
    catalog?: unknown;
  };
  const workspace = parsePinDesktopWorkspace(body.workspace);
  const catalog = OxspSlotCatalogSchema.parse(body.catalog);
  try {
    const bundle = syncDesktopFromClient(scope, workspace, catalog, baseRevision);
    emitDesktopChanged(scope, bundle.revision);
    return c.json({ ok: true, ...bundle });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("DESKTOP_REVISION_CONFLICT:")) {
      return c.json({ ok: false, error: "revision_conflict", revision: msg.split(":")[1] }, 409);
    }
    throw err;
  }
});
