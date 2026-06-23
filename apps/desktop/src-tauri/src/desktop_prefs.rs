use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPrefs {
    pub close_to_tray: bool,
    pub start_minimized: bool,
    pub low_memory_mode: bool,
}

impl Default for DesktopPrefs {
    fn default() -> Self {
        Self {
            close_to_tray: true,
            start_minimized: false,
            low_memory_mode: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WindowGeometry {
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub maximized: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TrayStatus {
    pub server_ready: bool,
    pub running_goals: u32,
    pub tooltip: Option<String>,
}

pub struct DesktopState {
    pub prefs: DesktopPrefs,
    pub prefs_path: PathBuf,
    pub window_state_path: PathBuf,
    pub tray_status: TrayStatus,
}

impl DesktopState {
    pub fn load(app: &AppHandle) -> Self {
        let config_dir = app
            .path()
            .app_config_dir()
            .unwrap_or_else(|_| PathBuf::from("."));
        let _ = fs::create_dir_all(&config_dir);
        let prefs_path = config_dir.join("desktop-prefs.json");
        let window_state_path = config_dir.join("window-state.json");
        let prefs = fs::read_to_string(&prefs_path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        Self {
            prefs,
            prefs_path,
            window_state_path,
            tray_status: TrayStatus::default(),
        }
    }

    pub fn save_prefs(&self) -> Result<(), String> {
        let raw = serde_json::to_string_pretty(&self.prefs).map_err(|e| e.to_string())?;
        fs::write(&self.prefs_path, raw).map_err(|e| e.to_string())
    }

    pub fn load_window_geometry(&self) -> WindowGeometry {
        fs::read_to_string(&self.window_state_path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    pub fn save_window_geometry(&self, geometry: &WindowGeometry) -> Result<(), String> {
        let raw = serde_json::to_string_pretty(geometry).map_err(|e| e.to_string())?;
        fs::write(&self.window_state_path, raw).map_err(|e| e.to_string())
    }
}
