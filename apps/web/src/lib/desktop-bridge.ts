import { isTauri } from "./is-tauri";

export type DesktopPrefs = {
  closeToTray: boolean;
  startMinimized: boolean;
  lowMemoryMode: boolean;
};

export type TrayStatusPayload = {
  serverReady: boolean;
  runningGoals: number;
  tooltip?: string;
};

const DEFAULT_PREFS: DesktopPrefs = {
  closeToTray: true,
  startMinimized: false,
  lowMemoryMode: false,
};

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

export async function getDesktopPrefs(): Promise<DesktopPrefs> {
  if (!isTauri()) return DEFAULT_PREFS;
  try {
    return await invoke<DesktopPrefs>("desktop_get_prefs");
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function setDesktopPrefs(prefs: DesktopPrefs): Promise<void> {
  if (!isTauri()) return;
  await invoke("desktop_set_prefs", { prefs });
}

export async function updateTrayStatus(status: TrayStatusPayload): Promise<void> {
  if (!isTauri()) return;
  await invoke("desktop_update_tray", { status });
}

export async function desktopQuit(): Promise<void> {
  if (!isTauri()) return;
  await invoke("desktop_quit");
}

export async function desktopShowMain(center = false): Promise<void> {
  if (!isTauri()) return;
  await invoke("desktop_show_main", { center });
}

export async function listenServerReady(
  handler: (ready: boolean) => void,
): Promise<() => void> {
  if (!isTauri()) {
    handler(true);
    return () => {};
  }
  const { listen } = await import("@tauri-apps/api/event");
  let disposed = false;
  let readyPoll: number | undefined;
  const probeServerReady = async () => {
    try {
      const response = await fetch("http://127.0.0.1:3921/api/health", {
        cache: "no-store",
      });
      if (!disposed && response.ok) {
        handler(true);
        if (readyPoll != null) {
          window.clearInterval(readyPoll);
          readyPoll = undefined;
        }
      }
    } catch {
      // 服务端启动期间健康检查失败是预期情况，继续等待 Tauri 事件或下一次轮询。
    }
  };
  const unlisten = await listen<boolean>("server-ready", (event) => {
    if (disposed) return;
    handler(Boolean(event.payload));
    if (event.payload && readyPoll != null) {
      window.clearInterval(readyPoll);
      readyPoll = undefined;
    }
  });
  void probeServerReady();
  readyPoll = window.setInterval(() => {
    void probeServerReady();
  }, 1000);
  return () => {
    disposed = true;
    if (readyPoll != null) {
      window.clearInterval(readyPoll);
    }
    unlisten();
  };
}

export async function listenDesktopNewGoal(handler: () => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen("desktop-new-goal", () => handler());
  return unlisten;
}

export async function minimizeWindow(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().minimize();
}

export async function toggleMaximizeWindow(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  if (await win.isMaximized()) {
    await win.unmaximize();
  } else {
    await win.maximize();
  }
}

export async function closeWindow(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().close();
}

export async function isWindowMaximized(): Promise<boolean> {
  if (!isTauri()) return false;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().isMaximized();
}

export function onWindowMaximizedChange(handler: (maximized: boolean) => void): () => void {
  if (!isTauri()) return () => {};
  let disposed = false;
  let unlisten: (() => void) | undefined;
  void (async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    unlisten = await win.onResized(async () => {
      if (disposed) return;
      handler(await win.isMaximized());
    });
  })();
  return () => {
    disposed = true;
    unlisten?.();
  };
}
