mod desktop_prefs;
mod tray_icon;

use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use desktop_prefs::{DesktopPrefs, DesktopState, TrayStatus, WindowGeometry};
use tray_icon::{tray_icon_booting, tray_icon_busy, tray_icon_idle};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalSize, State, WebviewWindow,
};
use tauri_plugin_shell::ShellExt;

fn openx_log_dir() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))?;
    Some(PathBuf::from(home).join(".openx").join("logs"))
}

fn append_desktop_log(line: &str) {
    let Some(dir) = openx_log_dir() else {
        return;
    };
    if create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join("desktop.log");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{}", line);
    }
}

/// 等待 Hono server 在 :3921 就绪
fn wait_for_server(port: u16, timeout_secs: u64) -> bool {
    let deadline = std::time::Instant::now() + Duration::from_secs(timeout_secs);
    let url = format!("http://127.0.0.1:{}/api/health", port);
    while std::time::Instant::now() < deadline {
        if let Ok(resp) = reqwest::blocking::get(&url) {
            if resp.status().is_success() {
                return true;
            }
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    false
}

fn tray_tooltip(status: &TrayStatus) -> String {
    if let Some(tip) = status.tooltip.as_ref() {
        return tip.clone();
    }
    if !status.server_ready {
        return "OpenX — 启动中…".into();
    }
    if status.running_goals > 0 {
        return format!("OpenX — {} 个任务运行中", status.running_goals);
    }
    "OpenX".into()
}

fn tray_icon_for_status(status: &TrayStatus) -> tauri::image::Image<'static> {
    if !status.server_ready {
        return tray_icon_booting();
    }
    if status.running_goals > 0 {
        return tray_icon_busy();
    }
    tray_icon_idle()
}

fn rebuild_tray_menu(app: &AppHandle, status: &TrayStatus) -> Result<(), tauri::Error> {
    let Some(tray) = app.tray_by_id("openx-tray") else {
        return Ok(());
    };
    let open_item = MenuItemBuilder::with_id("open", "打开 OpenX").build(app)?;
    let center_item = MenuItemBuilder::with_id("center", "居中主窗口").build(app)?;
    let new_goal_item = MenuItemBuilder::with_id("new_goal", "新建目标").build(app)?;
    let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;
    let status_label = if status.server_ready {
        if status.running_goals > 0 {
            format!("运行中任务：{}", status.running_goals)
        } else {
            "服务已就绪".to_string()
        }
    } else {
        "服务启动中…".to_string()
    };
    let status_item = MenuItemBuilder::with_id("status", &status_label)
        .enabled(false)
        .build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&open_item)
        .item(&center_item)
        .item(&new_goal_item)
        .separator()
        .item(&status_item)
        .separator()
        .item(&quit_item)
        .build()?;
    tray.set_menu(Some(menu))?;
    tray.set_tooltip(Some(tray_tooltip(status)))?;
    tray.set_icon(Some(tray_icon_for_status(status)))?;
    Ok(())
}

fn show_main_window(window: &WebviewWindow, center: bool) {
    if center {
        let _ = window.center();
    }
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

fn restore_window_geometry(window: &WebviewWindow, geometry: &WindowGeometry) {
    if let (Some(w), Some(h)) = (geometry.width, geometry.height) {
        let _ = window.set_size(PhysicalSize::new(w, h));
    }
    if let (Some(x), Some(y)) = (geometry.x, geometry.y) {
        let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    }
    if geometry.maximized {
        let _ = window.maximize();
    }
}

fn capture_window_geometry(window: &WebviewWindow) -> Result<WindowGeometry, String> {
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let maximized = window.is_maximized().map_err(|e| e.to_string())?;
    Ok(WindowGeometry {
        x: Some(pos.x),
        y: Some(pos.y),
        width: Some(size.width),
        height: Some(size.height),
        maximized,
    })
}

fn persist_window_geometry(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Some(state) = app.try_state::<Mutex<DesktopState>>() else {
        return;
    };
    if let Ok(geometry) = capture_window_geometry(&window) {
        if let Ok(guard) = state.lock() {
            let _ = guard.save_window_geometry(&geometry);
        }
    }
}

fn handle_close_request(app: &AppHandle, window: &tauri::Window) {
    persist_window_geometry(app);
    let close_to_tray = app
        .try_state::<Mutex<DesktopState>>()
        .and_then(|state| state.lock().ok().map(|guard| guard.prefs.close_to_tray))
        .unwrap_or(true);
    if close_to_tray {
        let _ = window.hide();
        return;
    }
    kill_sidecar(app);
    app.exit(0);
}

#[tauri::command]
fn desktop_get_prefs(state: State<'_, Mutex<DesktopState>>) -> Result<DesktopPrefs, String> {
    state
        .lock()
        .map(|s| s.prefs.clone())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn desktop_set_prefs(
    prefs: DesktopPrefs,
    state: State<'_, Mutex<DesktopState>>,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.prefs = prefs;
    guard.save_prefs()
}

#[tauri::command]
fn desktop_update_tray(
    status: TrayStatus,
    app: AppHandle,
    state: State<'_, Mutex<DesktopState>>,
) -> Result<(), String> {
    {
        let mut guard = state.lock().map_err(|e| e.to_string())?;
        guard.tray_status = status;
    }
    let guard = state.lock().map_err(|e| e.to_string())?;
    rebuild_tray_menu(&app, &guard.tray_status).map_err(|e| e.to_string())
}

#[tauri::command]
fn desktop_quit(app: AppHandle) {
    persist_window_geometry(&app);
    kill_sidecar(&app);
    app.exit(0);
}

#[tauri::command]
fn desktop_show_main(center: bool, app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window missing".to_string())?;
    show_main_window(&window, center);
    Ok(())
}

#[tauri::command]
fn desktop_emit_new_goal(app: AppHandle) -> Result<(), String> {
    app.emit("desktop-new-goal", ())
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            desktop_get_prefs,
            desktop_set_prefs,
            desktop_update_tray,
            desktop_quit,
            desktop_show_main,
            desktop_emit_new_goal,
        ])
        .setup(|app| {
            let app_handle = app.handle().clone();
            let desktop_state = DesktopState::load(&app_handle);
            let start_minimized = desktop_state.prefs.start_minimized;
            let geometry = desktop_state.load_window_geometry();
            app.manage(Mutex::new(desktop_state));

            if let Some(window) = app.get_webview_window("main") {
                restore_window_geometry(&window, &geometry);
                if start_minimized {
                    let _ = window.hide();
                }
                // debug / 测试包：打开 DevTools，便于看前端与网络日志
                #[cfg(debug_assertions)]
                {
                    window.open_devtools();
                }
            }

            // ---- Spawn Node.js sidecar ----
            let shell = app.shell();
            let sidecar_cmd = shell
                .sidecar("openx-server")
                .expect("failed to find openx-server sidecar binary");

            let (mut rx, child) = sidecar_cmd
                .spawn()
                .expect("failed to spawn openx-server sidecar");

            let pid = child.pid();
            app.manage(SidecarPid(pid));
            println!("[openx-desktop] sidecar spawned, pid={}", pid);
            append_desktop_log(&format!("[openx-desktop] sidecar spawned, pid={}", pid));
            #[cfg(debug_assertions)]
            if let Some(dir) = openx_log_dir() {
                println!(
                    "[openx-desktop] 日志文件: {}\\desktop.log",
                    dir.display()
                );
            }

            std::thread::spawn(move || {
                use tauri_plugin_shell::process::CommandEvent;
                while let Some(event) = rx.blocking_recv() {
                    match event {
                        CommandEvent::Stdout(line) => {
                            let text = String::from_utf8_lossy(&line);
                            let msg = format!("[sidecar] {}", text.trim());
                            println!("{}", msg);
                            append_desktop_log(&msg);
                        }
                        CommandEvent::Stderr(line) => {
                            let text = String::from_utf8_lossy(&line);
                            let msg = format!("[sidecar:err] {}", text.trim());
                            eprintln!("{}", msg);
                            append_desktop_log(&msg);
                        }
                        CommandEvent::Terminated(payload) => {
                            let msg = format!("[sidecar] terminated: code={:?}", payload.code);
                            println!("{}", msg);
                            append_desktop_log(&msg);
                            break;
                        }
                        _ => {}
                    }
                }
            });

            let app_for_ready = app_handle.clone();
            std::thread::spawn(move || {
                println!("[openx-desktop] waiting for server on :3921 ...");
                let ready = wait_for_server(3921, 30);
                if ready {
                    println!("[openx-desktop] server ready");
                } else {
                    eprintln!("[openx-desktop] server did not start within 30s");
                }
                let _ = app_for_ready.emit("server-ready", ready);
                if let Some(window) = app_for_ready.get_webview_window("main") {
                    if !start_minimized {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                if let Ok(mut state) = app_for_ready.state::<Mutex<DesktopState>>().lock() {
                    state.tray_status.server_ready = ready;
                    let status = state.tray_status.clone();
                    let _ = rebuild_tray_menu(&app_for_ready, &status);
                }
            });

            // 仅代码侧创建托盘，避免与 tauri.conf.json trayIcon 重复导致双图标
            TrayIconBuilder::with_id("openx-tray")
                .icon(tray_icon_booting())
                .tooltip("OpenX — 启动中…")
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            show_main_window(&window, false);
                        }
                    }
                    "center" => {
                        if let Some(window) = app.get_webview_window("main") {
                            show_main_window(&window, true);
                        }
                    }
                    "new_goal" => {
                        if let Some(window) = app.get_webview_window("main") {
                            show_main_window(&window, false);
                        }
                        let _ = app.emit("desktop-new-goal", ());
                    }
                    "quit" => {
                        persist_window_geometry(app);
                        kill_sidecar(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(move |tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            show_main_window(&window, false);
                        }
                    }
                })
                .build(app)?;

            if let Ok(state) = app.state::<Mutex<DesktopState>>().lock() {
                let _ = rebuild_tray_menu(&app_handle, &state.tray_status);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            let app = window.app_handle();
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    handle_close_request(&app, window);
                }
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => {
                    persist_window_geometry(&app);
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error building OpenX desktop app")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                kill_sidecar(app_handle);
            }
        });
}

/// Sidecar 进程 PID
struct SidecarPid(u32);

/// 强制终止 sidecar 进程
fn kill_sidecar(app: &AppHandle) {
    if let Some(state) = app.try_state::<SidecarPid>() {
        let pid = state.inner().0;
        println!("[openx-desktop] killing sidecar pid={}", pid);
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F", "/T"])
            .creation_flags(0x08000000)
            .output();
    }
}
