//! Methods the sidecar asks the shell to perform.
//!
//! Everything here is a capability the Node process cannot have: OS dialogs, the
//! default browser, window creation, the updater. The sidecar is allowed to ask
//! for exactly the methods in `HOST_RPC_METHODS`; anything else is rejected
//! before dispatch, so a compromised sidecar gains nothing by inventing a method
//! name.

use std::path::PathBuf;
use std::sync::Arc;

use serde_json::{json, Value};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use super::protocol::{is_host_rpc_method, WireError};
use super::Supervisor;

pub async fn handle(
    app: &AppHandle,
    supervisor: &Arc<Supervisor>,
    method: &str,
    params: Value,
) -> Result<Value, WireError> {
    if !is_host_rpc_method(method) {
        return Err(WireError::new(
            "rpc_method_not_allowed",
            format!("rpc_method_not_allowed: {method}"),
        ));
    }

    match method {
        "app.version" => Ok(json!(app.package_info().version.to_string())),

        "app.quit" => {
            app.exit(0);
            Ok(Value::Null)
        }

        "path.get" => {
            let name = params
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(|| WireError::new("invalid_message", "path.get needs a name"))?;

            Ok(json!(crate::sidecar::config::resolve_named_path(app, name)?))
        }

        "path.resources" => {
            let dir = app
                .path()
                .resource_dir()
                .map_err(|error| WireError::new("path_unavailable", error.to_string()))?;
            Ok(json!(dir.to_string_lossy()))
        }

        "clipboard.writeText" => {
            // Write-only, exactly like the baseline (`clipboard-write-text.ts`).
            Err(WireError::new(
                "rpc_method_not_allowed",
                "clipboard.writeText is handled by the renderer's clipboard API",
            ))
        }

        "dialog.showOpenDialog" => crate::dialogs::open(app, &params).await,
        "dialog.showSaveDialog" => crate::dialogs::save(app, &params).await,
        "dialog.showMessageBox" => crate::dialogs::message(app, &params).await,
        "dialog.showErrorBox" => crate::dialogs::error_box(app, &params),

        "shell.openExternal" => crate::shell::open_external(&params),
        "shell.openPath" => crate::shell::open_path(&params),
        "shell.showItemInFolder" => crate::shell::show_item_in_folder(&params),

        "power.setSleepBlocked" => crate::power::set_sleep_blocked(&params),

        "notification.show" => crate::notifications::show(app, &params).await,

        "autolaunch.get" => crate::platform::autolaunch_get(app, &params).await,
        "autolaunch.set" => crate::platform::autolaunch_set(app, &params).await,

        "tray.create" => crate::tray::create(app, supervisor, &params).await,
        "tray.setMenu" => crate::tray::set_menu(app, &params).await,
        "tray.setTooltip" => crate::tray::set_tooltip(app, &params).await,
        "tray.setIcon" => crate::tray::set_icon(app, &params).await,
        "tray.remove" => crate::tray::remove(app).await,

        "updater.check" => {
            let state = app
                .try_state::<crate::updater::UpdaterState>()
                .ok_or_else(|| WireError::new("updater_unavailable", "no updater state"))?;
            crate::updater::check(app, supervisor, &state).await
        }
        "updater.download" => {
            let state = app
                .try_state::<crate::updater::UpdaterState>()
                .ok_or_else(|| WireError::new("updater_unavailable", "no updater state"))?;
            crate::updater::download(app, supervisor, &state).await
        }
        "updater.install" => {
            let state = app
                .try_state::<crate::updater::UpdaterState>()
                .ok_or_else(|| WireError::new("updater_unavailable", "no updater state"))?;
            crate::updater::install(app, &state).await
        }
        "updater.state" => {
            let state = app
                .try_state::<crate::updater::UpdaterState>()
                .ok_or_else(|| WireError::new("updater_unavailable", "no updater state"))?;
            Ok(crate::updater::state_snapshot(&state))
        }

        "keychain.get" | "keychain.set" | "keychain.delete" => {
            crate::keychain::handle(method, &params)
        }

        "window.create" => create_window(app, supervisor, &params).await,
        "window.call" => call_window(app, &params).await,

        other => Err(WireError::new(
            "rpc_method_not_allowed",
            format!("rpc_method_not_allowed: {other}"),
        )),
    }
}

fn string_param(params: &Value, key: &str) -> Result<String, WireError> {
    params
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| WireError::new("invalid_message", format!("missing string parameter: {key}")))
}

fn bool_param(params: &Value, key: &str, fallback: bool) -> bool {
    params.get(key).and_then(Value::as_bool).unwrap_or(fallback)
}

fn number_param(params: &Value, key: &str) -> Option<f64> {
    params.get(key).and_then(Value::as_f64)
}

/// `new BrowserWindow(options)` from the sidecar.
///
/// The window is created by Rust because only the shell owns a `WebviewWindow`.
/// The descriptor is deliberately small: the members the sidecar actually passes
/// are mapped, everything else is ignored rather than guessed.
async fn create_window(
    app: &AppHandle,
    supervisor: &Arc<Supervisor>,
    params: &Value,
) -> Result<Value, WireError> {
    let label = string_param(params, "label")?;
    let url = string_param(params, "url")?;
    let options = params.get("options").cloned().unwrap_or_else(|| json!({}));

    if app.get_webview_window(&label).is_some() {
        return Ok(json!({ "windowId": 0, "existing": true }));
    }

    let webview_url = if url.starts_with("http://") || url.starts_with("https://") {
        WebviewUrl::External(
            url.parse()
                .map_err(|error| WireError::new("invalid_url", format!("{url}: {error}")))?,
        )
    } else {
        WebviewUrl::App(PathBuf::from(url.trim_start_matches('/')))
    };

    let mut builder = WebviewWindowBuilder::new(app, &label, webview_url)
        .title(
            options
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("Sphinx Launcher"),
        )
        .visible(bool_param(&options, "show", false))
        .resizable(bool_param(&options, "resizable", true))
        .decorations(bool_param(&options, "frame", true))
        .fullscreen(bool_param(&options, "fullscreen", false))
        .transparent(bool_param(&options, "transparent", false));

    if let Some(width) = number_param(&options, "width") {
        if let Some(height) = number_param(&options, "height") {
            builder = builder.inner_size(width, height);
        }
    }

    if let Some(width) = number_param(&options, "minWidth") {
        if let Some(height) = number_param(&options, "minHeight") {
            builder = builder.min_inner_size(width, height);
        }
    }

    if bool_param(&options, "alwaysOnTop", false) {
        builder = builder.always_on_top(true);
    }

    if bool_param(&options, "skipTaskbar", false) {
        builder = builder.skip_taskbar(true);
    }

    // `ready-to-show`: the sidecar owns the `show()` call for windows it
    // creates, so it has to be told when the first page finished painting.
    // Fired once, on `Finished`, and only for the first load.
    let ready_supervisor = Arc::clone(supervisor);
    let ready_label = label.clone();
    builder = builder.on_page_load(move |_window, payload| {
        if payload.event() != PageLoadEvent::Finished {
            return;
        }

        let supervisor = Arc::clone(&ready_supervisor);
        let label = ready_label.clone();
        tauri::async_runtime::spawn(async move {
            supervisor.announce_window_ready(&label).await;
        });
    });

    builder
        .build()
        .map_err(|error| WireError::new("window_failed", format!("cannot create {label}: {error}")))?;

    supervisor.announce_window(&label, &url).await;

    Ok(json!({ "windowId": 0, "existing": false }))
}

/// `BrowserWindow.<method>()` from the sidecar.
///
/// Unknown methods return `not_implemented` instead of silently succeeding: a
/// window that claims to have focused but did not is much harder to debug than
/// an error in the sidecar log.
async fn call_window(app: &AppHandle, params: &Value) -> Result<Value, WireError> {
    let label = string_param(params, "label")?;
    let method = string_param(params, "method")?;
    let call_params = params.get("params").cloned().unwrap_or_else(|| json!({}));

    let Some(window) = app.get_webview_window(&label) else {
        return Err(WireError::new(
            "window_missing",
            format!("no window labelled {label}"),
        ));
    };

    // Every arm produces `Result<Value, WireError>`; `ok` folds Tauri's error
    // type into the wire error so the sidecar sees one shape.
    let ok = |result: tauri::Result<()>| {
        result
            .map(|_| Value::Null)
            .map_err(|error| WireError::new("window_failed", error.to_string()))
    };

    match method.as_str() {
        "show" => ok(window.show()),
        "hide" => ok(window.hide()),
        "focus" => ok(window.set_focus()),
        "blur" => Ok(Value::Null),
        "close" => ok(window.close()),
        "minimize" => ok(window.minimize()),
        "maximize" => ok(window.maximize()),
        "unmaximize" => ok(window.unmaximize()),
        "restore" => ok(window.unminimize()),
        "setFullScreen" => ok(window.set_fullscreen(bool_param(
            &call_params,
            "fullscreen",
            false,
        ))),
        "setAlwaysOnTop" => ok(window.set_always_on_top(bool_param(
            &call_params,
            "alwaysOnTop",
            false,
        ))),
        "setIgnoreMouseEvents" => ok(window.set_ignore_cursor_events(bool_param(
            &call_params,
            "ignore",
            false,
        ))),
        "setSkipTaskbar" => ok(window.set_skip_taskbar(bool_param(
            &call_params,
            "skip",
            false,
        ))),
        "setTitle" => ok(window.set_title(&string_param(&call_params, "title")?)),
        "setBounds" => {
            let width = number_param(&call_params, "width");
            let height = number_param(&call_params, "height");
            let x = number_param(&call_params, "x");
            let y = number_param(&call_params, "y");

            if let (Some(width), Some(height)) = (width, height) {
                let _ = window.set_size(tauri::LogicalSize::new(width, height));
            }
            if let (Some(x), Some(y)) = (x, y) {
                let _ = window.set_position(tauri::LogicalPosition::new(x, y));
            }
            Ok(Value::Null)
        }
        "openDevTools" | "toggleDevTools" => {
            window.open_devtools();
            Ok(Value::Null)
        }
        "closeDevTools" => {
            window.close_devtools();
            Ok(Value::Null)
        }
        "setOpacity" | "setFocusable" | "setProgressBar" => Err(WireError::new(
            "not_implemented",
            format!("{method} has no Tauri v2 equivalent and is not emulated"),
        )),
        other => Err(WireError::new(
            "not_implemented",
            format!("window.{other} is not implemented by the shell"),
        )),
    }
}
