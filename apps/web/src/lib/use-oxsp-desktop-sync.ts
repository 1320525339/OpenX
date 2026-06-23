import { useCallback, useEffect, useRef } from "react";
import type { OxspSlotCatalog, PinDesktopScope } from "@openx/shared";
import type { PinDesktopWorkspace } from "./pin-desktop-workspace";
import { saveOxspCatalog } from "./oxsp-catalog";
import { savePinWorkspace } from "./pin-desktop-workspace";

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
    const res = await fetch(`/api/desktop/slots?scope=${scope}`);
    if (!res.ok) return null;
    return (await res.json()) as DesktopBundleResponse;
  } catch {
    return null;
  }
}

async function pushDesktop(
  scope: PinDesktopScope,
  workspace: PinDesktopWorkspace,
  catalog: OxspSlotCatalog,
  revision: number,
): Promise<DesktopBundleResponse | null> {
  try {
    const res = await fetch(`/api/desktop/state?scope=${scope}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-openx-desktop-revision": String(revision),
      },
      body: JSON.stringify({ workspace, catalog }),
    });
    if (!res.ok) return null;
    return (await res.json()) as DesktopBundleResponse;
  } catch {
    return null;
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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const remote = await fetchDesktop(scope);
      if (cancelled || !remote) return;
      revisionRef.current = remote.revision;
      if (hasLocalWorkspace(scope)) return;
      skipPushRef.current = true;
      onRemote({
        workspace: remote.workspace,
        catalog: remote.catalog,
        revision: remote.revision,
      });
      savePinWorkspace(scope, remote.workspace);
      saveOxspCatalog(scope, remote.catalog);
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
    if (skipPushRef.current) {
      skipPushRef.current = false;
      return;
    }
    if (pushTimerRef.current != null) window.clearTimeout(pushTimerRef.current);
    pushTimerRef.current = window.setTimeout(() => {
      void pushDesktop(scope, workspace, catalog, revisionRef.current).then((remote) => {
        if (!remote) return;
        revisionRef.current = remote.revision;
      });
    }, 600);
  }, [scope, workspace, catalog]);

  useEffect(() => {
    schedulePush();
  }, [schedulePush]);

  useEffect(() => {
    return () => {
      if (pushTimerRef.current != null) window.clearTimeout(pushTimerRef.current);
    };
  }, []);
}
