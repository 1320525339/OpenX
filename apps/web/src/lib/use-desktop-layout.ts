import { useCallback, useState } from "react";

export type DesktopScene = "planning" | "execution" | "dispatch";
export type DockMode = "chat" | "tasks" | "artifacts" | "fleet";

const SCENE_KEY = "openx.desktopScene";
const DOCK_KEY = "openx.desktopDock";
const CONVERSATION_DOCK_KEY = "openx.conversationDock";

const SCENE_DEFAULTS: Record<
  DesktopScene,
  { dockMode: DockMode; label: string }
> = {
  dispatch: { dockMode: "tasks", label: "调度桌面" },
  planning: { dockMode: "chat", label: "派单桌面" },
  execution: { dockMode: "artifacts", label: "施工桌面" },
};

function loadScene(): DesktopScene {
  try {
    const raw = localStorage.getItem(SCENE_KEY);
    if (raw === "planning" || raw === "execution" || raw === "dispatch") return raw;
  } catch {
    /* ignore */
  }
  return "dispatch";
}

function loadDock(fallback: DockMode, scope: "console" | "conversation"): DockMode {
  const key = scope === "conversation" ? CONVERSATION_DOCK_KEY : DOCK_KEY;
  try {
    const raw = localStorage.getItem(key);
    if (raw === "chat" || raw === "tasks" || raw === "artifacts" || raw === "fleet") {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

export function useDesktopLayout(
  initialScene: DesktopScene = "dispatch",
  scope: "console" | "conversation" = "console",
) {
  const [scene, setSceneState] = useState<DesktopScene>(() => loadScene() || initialScene);
  const [dockMode, setDockModeState] = useState<DockMode>(() => {
    if (scope === "conversation") {
      return loadDock("chat", scope);
    }
    const loadedScene = loadScene() || initialScene;
    return loadDock(SCENE_DEFAULTS[loadedScene].dockMode, scope);
  });

  const setScene = useCallback((next: DesktopScene) => {
    setSceneState(next);
    const preset = SCENE_DEFAULTS[next];
    setDockModeState(preset.dockMode);
    try {
      localStorage.setItem(SCENE_KEY, next);
      localStorage.setItem(DOCK_KEY, preset.dockMode);
    } catch {
      /* ignore */
    }
  }, []);

  const setDockMode = useCallback((next: DockMode) => {
    setDockModeState(next);
    try {
      localStorage.setItem(
        scope === "conversation" ? CONVERSATION_DOCK_KEY : DOCK_KEY,
        next,
      );
    } catch {
      /* ignore */
    }
  }, [scope]);

  return {
    scene,
    setScene,
    dockMode,
    setDockMode,
    sceneLabel: SCENE_DEFAULTS[scene].label,
    sceneOptions: SCENE_DEFAULTS,
  };
}
