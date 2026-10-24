//! System tray, built from a menu model the sidecar sends.
//!
//! The baseline builds the tray in `src/main/services/window-manager.ts`
//! (`createSystemTray`) because the menu lists the six most recently played
//! games, which live in LevelDB — and LevelDB belongs to the sidecar. Rather
//! than move that query into Rust, the sidecar keeps building the menu and sends
//! the *model* over RPC; this module turns the model into native `muda` items.
//!
//! Menu clicks travel back as `control tray-click`, so the `click` closures in
//! `createSystemTray` still run in the sidecar. Nothing about the baseline's
//! menu logic is duplicated here.
//!
//! Sources:
//! - tray builder: <https://docs.rs/tauri/latest/tauri/tray/struct.TrayIconBuilder.html>
//! - tray events: <https://docs.rs/tauri/latest/tauri/tray/enum.TrayIconEvent.html>
//! - menu items: <https://docs.rs/tauri/latest/tauri/menu/struct.MenuItem.html>
//! - menu separators: <https://docs.rs/tauri/latest/tauri/menu/struct.PredefinedMenuItem.html>

use std::sync::Arc;

use serde::Deserialize;
use serde_json::Value;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::sidecar::protocol::WireError;
use crate::sidecar::Supervisor;

/// One entry of the menu the sidecar sends.
///
/// Only the fields the baseline actually uses are modelled. `MenuItem` in
/// Electron also carries `role`, `submenu` and `accelerator`; the tray menu uses
/// none of them, so an unknown field is ignored instead of guessed at.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MenuEntry {
    /// Stable id the shim maps back to the `click` closure.
    id: Option<String>,
    label: Option<String>,
    #[serde(rename = "type")]
    kind: Option<String>,
    #[serde(default = "default_enabled")]
    enabled: bool,
}

fn default_enabled() -> bool {
    true
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrayModel {
    tooltip: Option<String>,
    items: Vec<MenuEntry>,
}

/// Tray id. One tray per app, as in the baseline.
const TRAY_ID: &str = "sphinx-tray";

/// Builds the native menu from the model.
fn build_menu(app: &AppHandle, model: &TrayModel) -> Result<Menu<tauri::Wry>, WireError> {
    let menu = Menu::new(app).map_err(|error| WireError::new("tray_failed", error.to_string()))?;

    for (index, entry) in model.items.iter().enumerate() {
        if entry.kind.as_deref() == Some("separator") {
            let separator = PredefinedMenuItem::separator(app)
                .map_err(|error| WireError::new("tray_failed", error.to_string()))?;
            menu.append(&separator)
                .map_err(|error| WireError::new("tray_failed", error.to_string()))?;
            continue;
        }

        // The shim always sends an id; the fallback keeps a malformed model
        // from producing a clickable item that goes nowhere.
        let id = entry
            .id
            .clone()
            .unwrap_or_else(|| format!("tray-item-{index}"));
        let item = MenuItem::with_id(
            app,
            id,
            entry.label.clone().unwrap_or_default(),
            entry.enabled,
            None::<&str>,
        )
        .map_err(|error| WireError::new("tray_failed", error.to_string()))?;

        menu.append(&item)
            .map_err(|error| WireError::new("tray_failed", error.to_string()))?;
    }

    Ok(menu)
}

/// Resolves the tray icon for the current system theme.
///
/// The baseline swaps between `tray-icon.png` (white, for a dark taskbar) and
/// `tray-icon-dark.png` (black) and re-swaps on `nativeTheme.updated`
/// (`window-manager.ts:1185-1194`). Rust cannot observe that Electron event, so
/// the icon is chosen from the window theme each time the tray is created or
/// its menu is replaced — which happens on every right-click, because
/// `createSystemTray` rebuilds the menu in its `popUpContextMenu` handler.
fn tray_icon(app: &AppHandle) -> Option<Image<'static>> {
    let use_dark_colors = app
        .get_webview_window("main")
        .and_then(|window| window.theme().ok())
        .map(|theme| theme == tauri::Theme::Dark)
        .unwrap_or(true);

    let file_name = if use_dark_colors {
        "tray-icon.png"
    } else {
        "tray-icon-dark.png"
    };

    let path = crate::sidecar::config::resolve_resource(app, file_name).ok()?;
    match Image::from_path(&path) {
        Ok(image) => Some(image),
        Err(error) => {
            eprintln!("[tray] cannot load {}: {error}", path.display());
            None
        }
    }
}

/// `new Tray(icon)` + the first `setContextMenu`.
pub async fn create(app: &AppHandle, supervisor: &Arc<Supervisor>, params: &Value) -> Result<Value, WireError> {
    let model: TrayModel = serde_json::from_value(params.clone())
        .map_err(|error| WireError::new("invalid_message", error.to_string()))?;

    let menu = build_menu(app, &model)?;

    if app.tray_by_id(TRAY_ID).is_some() {
        // Already alive: `new Tray()` twice would leak a second icon.
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            tray.set_menu(Some(menu))
                .map_err(|error| WireError::new("tray_failed", error.to_string()))?;
            if let Some(tooltip) = &model.tooltip {
                tray.set_tooltip(Some(tooltip))
                    .map_err(|error| WireError::new("tray_failed", error.to_string()))?;
            }
        }
        return Ok(serde_json::json!({ "created": false }));
    }

    let events = Arc::clone(supervisor);
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        // Windows/macOS: the OS shows the menu on right click. Linux ignores
        // this flag and always shows it on click, which is also the baseline's
        // Linux behaviour.
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_tray_icon_event(move |_tray, event| {
            let kind = match event {
                TrayIconEvent::DoubleClick { .. } => "double-click",
                TrayIconEvent::Click {
                    button: MouseButton::Right,
                    button_state: MouseButtonState::Up,
                    ..
                } => "right-click",
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } => "click",
                _ => return,
            };

            let supervisor = Arc::clone(&events);
            tauri::async_runtime::spawn(async move {
                supervisor.announce_tray_event(kind).await;
            });
        });

    if let Some(tooltip) = &model.tooltip {
        builder = builder.tooltip(tooltip);
    }

    if let Some(icon) = tray_icon(app) {
        builder = builder.icon(icon);
    }

    builder
        .build(app)
        .map_err(|error| WireError::new("tray_failed", error.to_string()))?;

    Ok(serde_json::json!({ "created": true }))
}

/// `tray.setContextMenu(menu)` and `tray.popUpContextMenu(menu)`.
///
/// Both map to replacing the attached menu. `popUpContextMenu` is what the
/// Windows path calls on right-click; the menu is already attached, so the OS
/// shows it and the replacement only refreshes the contents for the next click.
pub async fn set_menu(app: &AppHandle, _params: &Value) -> Result<Value, WireError> {
    let model: TrayModel = serde_json::from_value(_params.clone())
        .map_err(|error| WireError::new("invalid_message", error.to_string()))?;

    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Err(WireError::new("tray_missing", "no tray icon"));
    };

    let menu = build_menu(app, &model)?;
    tray.set_menu(Some(menu))
        .map_err(|error| WireError::new("tray_failed", error.to_string()))?;

    if let Some(tooltip) = &model.tooltip {
        let _ = tray.set_tooltip(Some(tooltip));
    }

    // Refresh the icon too: this is the only moment the shell knows the sidecar
    // is redrawing the tray, and it is where the baseline re-reads the theme.
    if let Some(icon) = tray_icon(app) {
        let _ = tray.set_icon(Some(icon));
    }

    Ok(Value::Null)
}

pub async fn set_tooltip(app: &AppHandle, params: &Value) -> Result<Value, WireError> {
    let tooltip = params
        .get("tooltip")
        .and_then(Value::as_str)
        .unwrap_or_default();

    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_tooltip(Some(tooltip))
            .map_err(|error| WireError::new("tray_failed", error.to_string()))?;
    }

    Ok(Value::Null)
}

pub async fn set_icon(app: &AppHandle, params: &Value) -> Result<Value, WireError> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(Value::Null);
    };

    // An explicit path wins (the baseline passes `trayIcon`/`trayIconDark`
    // constants); otherwise fall back to the theme-derived icon.
    let image = params
        .get("path")
        .and_then(Value::as_str)
        .and_then(|path| Image::from_path(path).ok())
        .or_else(|| tray_icon(app));

    if let Some(image) = image {
        tray.set_icon(Some(image))
            .map_err(|error| WireError::new("tray_failed", error.to_string()))?;
    }

    Ok(Value::Null)
}

pub async fn remove(app: &AppHandle) -> Result<Value, WireError> {
    let _ = app.remove_tray_by_id(TRAY_ID);
    Ok(Value::Null)
}

/// Registers the one menu handler the app needs.
///
/// `on_menu_event` fires for every menu in the app, including window menus, so
/// the handler only forwards ids the shim generated.
pub fn register_menu_handler(app: &AppHandle, supervisor: Arc<Supervisor>) {
    app.on_menu_event(move |_app, event| {
        let id = event.id().as_ref().to_string();
        if !id.starts_with("tray:") {
            return;
        }

        let supervisor = Arc::clone(&supervisor);
        tauri::async_runtime::spawn(async move {
            supervisor.announce_tray_click(&id).await;
        });
    });
}
