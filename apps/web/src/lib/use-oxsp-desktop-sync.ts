import { useCallback, useEffect, useRef, useState } from "react";
import type { OxspSlotCatalog, PinDesktopScope } from "@openx/shared";
import type { PinDesktopWorkspace } from "./pin-desktop-workspace";
import { saveOxspCatalog } from "./oxsp-catalog";
import { savePinWorkspace } from "./pin-desktop-workspace";
import { getApiBase } from "./api-base";

const WORKSPACE_STORAGE_KEY = "openx.pinDesktop.workspace";

function hasLocalWorkspace(scope: PinDesktopScope): boolean {
  try {
    return localStorage.getItem(`${WORKSPACE_STORAGE_KEY}.${scope}`) != null;
  } catch {
    return false;
  }
}

type DesktopBundleResponse = {
  revision: number;
  workspace: PinDesktopWorkspace;
  catalog: OxspSlotCatalog;
};

async function fetchDesktop(scope: PinDesktopScope): Promise<DesktopBundleResponse | null> {
  try {
    const res = await fetch(`${getApiBase()}/api/desktop/slots?scope=${scope}`);
    if (!res.ok) return null;
    return (await res.json()) as DesktopBundleResponse;
  } catch {
    return null;
  }
}

type PushDesktopResult =
  | { kind: "ok"; bundle: DesktopBundleResponse }
  | { kind: "conflict"; revision: number | null }
  | { kind: "failed" };

async function pushDesktop(
  scope: PinDesktopScope,
  workspace: PinDesktopWorkspace,
  catalog: OxspSlotCatalog,
  revision: number,
): Promise<PushDesktopResult> {
  try {
    const res = await fetch(`${getApiBase()}/api/desktop/state?scope=${scope}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-openx-desktop-revision": String(revision),
      },
      body: JSON.stringify({ workspace, catalog }),
    });
    if (res.ok) return { kind: "ok", bundle: (await res.json()) as DesktopBundleResponse };
    if (res.status === 409) {
      const body = (await res.json().catch(() => null)) as { revision?: unknown } | null;
      return {
        kind: "conflict",
        revision: typeof body?.revision === "string" ? Number(body.revision) : null,
      };
    }
    return { kind: "failed" };
  } catch {
    return { kind: "failed" };
  }
}

/** 启动时拉取服务端状态；本地变更后 debounce 上行同步 */
export function useOxspDesktopSync(
  scope: PinDesktopScope,
  workspace: PinDesktopWorkspace,
  catalog: OxspSlotCatalog,
  onRemote: (next: { workspace: PinDesktopWorkspace; catalog: OxspSlotCatalog; revision: number }) => void,
) {
  const revisionRef = useRef(0);
  const skipPushRef = useRef(false);
  const pushTimerRef = useRef<number | null>(null);
  const [syncReady, setSyncReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSyncReady(false);
    void (async () => {
      const remote = await fetchDesktop(scope);
      if (cancelled) return;
      if (!remote) {
        setSyncReady(true);
        return;
      }
      revisionRef.current = remote.revision;
      if (!hasLocalWorkspace(scope)) {
        skipPushRef.current = true;
        onRemote({
          workspace: remote.workspace,
          catalog: remote.catalog,
          revision: remote.revision,
        });
        savePinWorkspace(scope, remote.workspace);
        saveOxspCatalog(scope, remote.catalog);
      }
      setSyncReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // 仅 scope 变化时拉取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  useEffect(() => {
    const onDesktopChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail as { scope?: string };
      if (detail?.scope !== scope) return;
      void fetchDesktop(scope).then((remote) => {
        if (!remote) return;
        if (remote.revision <= revisionRef.current) return;
        revisionRef.current = remote.revision;
        skipPushRef.current = true;
        onRemote({
          workspace: remote.workspace,
          catalog: remote.catalog,
          revision: remote.revision,
        });
      });
    };
    window.addEventListener("openx-desktop-changed", onDesktopChanged);
    return () => window.removeEventListener("openx-desktop-changed", onDesktopChanged);
  }, [scope, onRemote]);

  const schedulePush = useCallback(() => {
    if (!syncReady) return;
    if (skipPushRef.current) {
      skipPushRef.current = false;
      return;
    }
    if (pushTimerRef.current != null) window.clearTimeout(pushTimerRef.current);
    pushTimerRef.current = window.setTimeout(() => {
      void pushDesktop(scope, workspace, catalog, revisionRef.current).then(async (result) => {
        if (result.kind === "ok") {
          revisionRef.current = result.bundle.revision;
          return;
        }
        if (result.kind !== "conflict") return;

        // A second tab may have changed the desktop after our initial read. Refresh
        // its revision, then replay this single local change once instead of leaving
        // the UI permanently out of sync with a noisy 409 in the console.
        const remote = await fetchDesktop(scope);
        const revision = remote?.revision ?? result.revision;
        if (revision == null || !Number.isFinite(revision)) return;
        revisionRef.current = revision;
        const retry = await pushDesktop(scope, workspace, catalog, revision);
        if (retry.kind === "ok") revisionRef.current = retry.bundle.revision;
      });
    }, 600);
  }, [catalog, scope, syncReady, workspace]);

  useEffect(() => {
    schedulePush();
  }, [schedulePush]);

  useEffect(() => {
    return () => {
      if (pushTimerRef.current != null) window.clearTimeout(pushTimerRef.current);
    };
  }, []);
}
