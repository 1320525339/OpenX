import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  emptyOxspCatalog,
  emptyPinWorkspace,
  migrateLegacyWebCards,
  OxspDesktopStateSchema,
  OxspSlotCatalogSchema,
  type OxspDesktopState,
  type OxspSlotCatalog,
  type PinDesktopScope,
  type PinDesktopWorkspace,
} from "@openx/shared";
import { atomicWriteJson } from "./atomic-json.js";
import { getOpenxDir } from "./paths.js";

function desktopDir(): string {
  return join(getOpenxDir(), "desktop");
}

function scopePath(scope: PinDesktopScope): string {
  return join(desktopDir(), `${scope}.json`);
}

function catalogPath(scope: PinDesktopScope): string {
  return join(desktopDir(), `${scope}.catalog.json`);
}

function defaultState(scope: PinDesktopScope): OxspDesktopState {
  return {
    revision: 0,
    scope,
    workspace: emptyPinWorkspace(),
  };
}

function readJson(path: string): unknown {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

export function loadDesktopState(scope: PinDesktopScope): OxspDesktopState {
  const raw = readJson(scopePath(scope));
  if (raw) {
    const parsed = OxspDesktopStateSchema.safeParse(raw);
    if (parsed.success) return parsed.data as OxspDesktopState;
  }
  return defaultState(scope);
}

export function saveDesktopState(state: OxspDesktopState): OxspDesktopState {
  const next = { ...state, revision: state.revision + 1 };
  atomicWriteJson(scopePath(state.scope), next);
  return next;
}

export function loadSlotCatalog(scope: PinDesktopScope): OxspSlotCatalog {
  const raw = readJson(catalogPath(scope));
  if (raw) {
    const parsed = OxspSlotCatalogSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
    const migrated = migrateLegacyWebCards(raw);
    if (migrated.slots.length > 0) return migrated;
  }
  return emptyOxspCatalog();
}

export function saveSlotCatalog(scope: PinDesktopScope, catalog: OxspSlotCatalog): void {
  atomicWriteJson(catalogPath(scope), catalog);
}

export function saveDesktopBundle(
  scope: PinDesktopScope,
  workspace: PinDesktopWorkspace,
  catalog: OxspSlotCatalog,
  baseRevision?: number,
): OxspDesktopState {
  const current = loadDesktopState(scope);
  if (baseRevision != null && baseRevision !== current.revision) {
    throw new Error(`DESKTOP_REVISION_CONFLICT:${current.revision}`);
  }
  saveSlotCatalog(scope, catalog);
  return saveDesktopState({
    revision: current.revision,
    scope,
    workspace,
  });
}
