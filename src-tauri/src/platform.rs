//! Single instance, deep links and autostart.
//!
//! The baseline did all three in `src/main/index.ts`:
//!
//! - `app.requestSingleInstanceLock()` + `app.on("second-instance")` —
//!   `index.ts:45`, `index.ts:305-327`;
//! - `app.setAsDefaultProtocolClient("sphinx")` + `sphinx://run?...` —
//!   `index.ts:78-85`, `index.ts:270-303`;
//! - `auto-launch` from the `autoLaunch` IPC handler —
//!   `src/main/events/user-preferences/auto-launch.ts`.
//!
//! In Tauri those are three plugins. The *decisions* stay in the sidecar: this
//! module only recognises that something happened and forwards it, so
//! `handleDeepLinkPath` and the `second-instance` window logic run exactly once,
//! in the same place, with the same arguments.
//!
//! Sources:
//! - single instance: <https://v2.tauri.app/plugin/single-instance/>
//! - deep linking: <https://v2.tauri.app/plugin/deep-linking/>
//! - `DeepLink::on_open_url`: <https://docs.rs/tauri-plugin-deep-link/latest/tauri_plugin_deep_link/struct.DeepLink.html>
//! - autostart: <https://v2.tauri.app/plugin/autostart/>

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::Value;
use tauri::{AppHandle, Manager, Theme};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_deep_link::DeepLinkExt;

use crate::ipc::AppState;
use crate::sidecar::protocol::WireError;
use crate::sidecar::Supervisor;

/// The scheme registered in `tauri.conf.json` (`plugins.deep-link.desktop`).
pub const SCHEME: &str = "sphinx";

/// Startup decision, computed once in `setup` and read by `on_page_load`.
#[derive(Debug, Clone, Copy)]
pub struct Startup {
    /// True when the process was started by the autostart entry *and* the user
    /// asked to start minimised. The window then stays hidden.
    pub hidden: bool,
}

/// Finds the first `sphinx://` argument.
///
/// Windows passes a deep link as a plain argv entry, which is why the baseline
/// scanned `process.argv`/`commandLine` instead of listening to an event
/// (`index.ts:201`, `index.ts:306`).
pub fn find_deep_link<I, S>(args: I) -> Option<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter()
        .map(|arg| arg.as_ref().to_string())
        .find(|arg| arg.starts_with("sphinx://"))
}

/// True when argv asks for Big Picture directly (`--big-picture`).
pub fn wants_big_picture<I, S>(args: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter().any(|arg| arg.as_ref() == "--big-picture")
}

fn has_hidden_flag<I, S>(args: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter().any(|arg| arg.as_ref() == "--hidden")
}

/// Where the "start minimised" preference is mirrored for the autostart entry.
///
/// The preference itself lives in LevelDB (`userPreferences.minimizedOnLaunch`)
/// and belongs to the sidecar. The autostart entry, however, is created by this
/// process before the sidecar has booted, so the value has to be readable
/// synchronously at startup. This file is a mirror, never the source of truth.
fn autostart_preference_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join("autostart.json"))
}

fn read_start_minimised(app: &AppHandle) -> bool {
    let Some(path) = autostart_preference_path(app) else {
        return true;
    };

    let Ok(raw) = std::fs::read_to_string(&path) else {
        return true;
    };

    serde_json::from_str::<Value>(&raw)
        .ok()
        .and_then(|value| value.get("minimised").and_then(Value::as_bool))
        .unwrap_or(true)
}

fn write_start_minimised(app: &AppHandle, minimised: bool) -> Result<(), WireError> {
    let Some(path) = autostart_preference_path(app) else {
        return Err(WireError::new(
            "path_unavailable",
            "cannot resolve the app config directory",
        ));
    };

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| WireError::new("io_error", error.to_string()))?;
    }

    std::fs::write(&path, format!("{{\"minimised\":{minimised}}}\n"))
        .map_err(|error| WireError::new("io_error", error.to_string()))
}

/// Decides whether this process should start without showing the window.
pub fn compute_startup(app: &AppHandle) -> Startup {
    let args: Vec<String> = std::env::args().collect();

    // Only an autostart launch may start hidden; a normal double-click always
    // shows the window, exactly like `if (!process.argv.includes("--hidden"))`
    // in `index.ts:205`.
    let hidden = has_hidden_flag(&args) && read_start_minimised(app);

    Startup { hidden }
}

/// Registers the deep-link listeners and replays the URL this process started
/// with.
///
/// `on_open_url` only fires while the app is running; a cold start has to read
/// the initial URL separately, which the plugin documents
/// (<https://v2.tauri.app/plugin/deep-linking/#first-launch>). `get_current`
/// covers Windows and Linux by reading argv.
pub fn register_deep_links(app: &AppHandle, supervisor: Arc<Supervisor>) {
    let listener_supervisor = Arc::clone(&supervisor);
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            let supervisor = Arc::clone(&listener_supervisor);
            let url = url.to_string();
            tauri::async_runtime::spawn(async move {
                supervisor.announce_deep_link(&url).await;
            });
        }
    });

    let initial = match app.deep_link().get_current() {
        Ok(urls) => urls.and_then(|urls| urls.into_iter().next()),
        Err(error) => {
            eprintln!("[platform] cannot read the initial deep link: {error}");
            None
        }
    };

    let initial = initial
        .map(|url| url.to_string())
        .or_else(|| find_deep_link(std::env::args()));

    if let Some(url) = initial {
        let supervisor = Arc::clone(&supervisor);
        tauri::async_runtime::spawn(async move {
            supervisor.announce_deep_link(&url).await;
        });
    }
}

/// Body of the single-instance callback.
///
/// The plugin calls this in the **first** process when a second one starts.
/// `argv` is the second process's command line, so it is the only place a
/// `sphinx://` link from that launch can be recovered.
pub fn handle_second_instance(app: &AppHandle, argv: &[String]) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };

    let deep_link = find_deep_link(argv);
    let force_big_picture = wants_big_picture(argv);

    // Focus immediately: the sidecar may still be booting, and a launcher that
    // ignores a double-click for a second feels broken.
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }

    let supervisor = Arc::clone(&state.supervisor);
    tauri::async_runtime::spawn(async move {
        supervisor
            .announce_second_instance(deep_link.as_deref(), force_big_picture)
            .await;
    });
}

/// `autoLaunch({ enabled, minimized })` from the baseline.
pub async fn autolaunch_set(app: &AppHandle, params: &Value) -> Result<Value, WireError> {
    let enabled = params
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let minimised = params
        .get("minimized")
        .and_then(Value::as_bool)
        .unwrap_or(true);

    // The `--hidden` flag is fixed at build time via `tauri_plugin_autostart::init`
    // in `lib.rs`, so the "start minimised" half of the preference is stored
    // here and read by `compute_startup`. Without this, turning the preference
    // off would still start hidden.
    write_start_minimised(app, minimised)?;

    let manager = app.autolaunch();
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };

    result.map_err(|error| WireError::new("autolaunch_failed", error.to_string()))?;

    Ok(serde_json::json!({ "enabled": enabled, "minimized": minimised }))
}

pub async fn autolaunch_get(app: &AppHandle, _params: &Value) -> Result<Value, WireError> {
    let enabled = app
        .autolaunch()
        .is_enabled()
        .map_err(|error| WireError::new("autolaunch_failed", error.to_string()))?;

    Ok(serde_json::json!({
        "enabled": enabled,
        "minimized": read_start_minimised(app),
    }))
}

/// Picks the tray/window theme once so callers do not each guess.
pub fn prefers_dark_colors(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|window| window.theme().ok())
        .map(|theme| theme == Theme::Dark)
        .unwrap_or(true)
}
