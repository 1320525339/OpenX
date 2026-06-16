import { useCallback, useState } from "react";

export type DesktopScene = "planning" | "execution" | "dispatch";
export type DockMode = "chat" | "tasks" | "artifacts" | "fleet";

const SCENE_KEY = "openx.desktopScene";
const DOCK_KEY = "openx.desktopDock";
const CONVERSATION_DOCK_KEY = "openx.conversationDock";

export const SCENE_DEFAULTS: Record<
  DesktopScene,
  { dockMode: DockMode; label: string }
> = {
  dispatch: { dockMode: "tasks", label: "调度桌面" },
  planning: { dockMode: "chat", label: "派单桌面" },
  execution: { dockMode: "artifacts", label: "施工桌面" },
};

/** 底栏模式 → 对应桌面场景（用于双向同步） */
export const DOCK_TO_SCENE: Record<DockMode, DesktopScene> = {
  chat: "planning",
  tasks: "dispatch",
  artifacts: "execution",
  fleet: "dispatch",
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

function loadStoredDock(key: string): DockMode | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === "chat" || raw === "tasks" || raw === "artifacts" || raw === "fleet") {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** 调度台：场景为主，底栏仅在属于同一场景时保留用户上次选择 */
export function resolveConsoleDock(scene: DesktopScene): DockMode {
  const fallback = SCENE_DEFAULTS[scene].dockMode;
  const stored = loadStoredDock(DOCK_KEY);
  if (stored && DOCK_TO_SCENE[stored] === scene) return stored;
  return fallback;
}

function loadDock(fallback: DockMode, scope: "console" | "conversation"): DockMode {
  if (scope === "conversation") {
    return loadStoredDock(CONVERSATION_DOCK_KEY) ?? fallback;
  }
  const scene = loadScene();
  return resolveConsoleDock(scene);
}

export function useDesktopLayout(
  initialScene: DesktopScene = "dispatch",
  scope: "console" | "conversation" = "console",
) {
  const [scene, setSceneState] = useState<DesktopScene>(() => {
    if (scope === "conversation") return initialScene;
    return loadScene() || initialScene;
  });
  const [dockMode, setDockModeState] = useState<DockMode>(() => {
    if (scope === "conversation") {
      return loadDock("chat", scope);
    }
    const loadedScene = loadScene() || initialScene;
    return resolveConsoleDock(loadedScene);
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

  const setDockMode = useCallback(
    (next: DockMode) => {
      setDockModeState(next);
      if (scope === "console") {
        const nextScene = DOCK_TO_SCENE[next];
        setSceneState(nextScene);
        try {
          localStorage.setItem(SCENE_KEY, nextScene);
          localStorage.setItem(DOCK_KEY, next);
        } catch {
          /* ignore */
        }
      } else {
        try {
          localStorage.setItem(CONVERSATION_DOCK_KEY, next);
        } catch {
          /* ignore */
        }
      }
    },
    [scope],
  );

  return {
    scene,
    setScene,
    dockMode,
    setDockMode,
    sceneLabel: SCENE_DEFAULTS[scene].label,
    sceneOptions: SCENE_DEFAULTS,
  };
}
