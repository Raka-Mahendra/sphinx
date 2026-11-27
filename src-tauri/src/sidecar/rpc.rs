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
use tauri::image::Image;
use tauri::webview::PageLoadEvent;
use tauri::window::{Color, ProgressBarState, ProgressBarStatus};
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

            Ok(json!(crate::sidecar::config::resolve_named_path(
                app, name
            )?))
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
            crate::updater::install(&state).await
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
        .ok_or_else(|| {
            WireError::new(
                "invalid_message",
                format!("missing string parameter: {key}"),
            )
        })
}

fn bool_param(params: &Value, key: &str, fallback: bool) -> bool {
    params.get(key).and_then(Value::as_bool).unwrap_or(fallback)
}

fn number_param(params: &Value, key: &str) -> Option<f64> {
    params.get(key).and_then(Value::as_f64)
}

/// Maps Electron's `setProgressBar` contract onto Tauri's.
///
/// Electron takes a ratio and uses the out-of-range ends as sentinels: below 0
/// removes the bar, above 1 makes it indeterminate. Tauri takes whole percent
/// (`0..=100`) plus an explicit status.
fn progress_bar_state(progress: f64) -> Result<ProgressBarState, WireError> {
    if !progress.is_finite() {
        return Err(WireError::new(
            "invalid_message",
            format!("progress is not a finite number: {progress}"),
        ));
    }

    if progress < 0.0 {
        return Ok(ProgressBarState {
            status: Some(ProgressBarStatus::None),
            progress: None,
        });
    }

    if progress > 1.0 {
        return Ok(ProgressBarState {
            status: Some(ProgressBarStatus::Indeterminate),
            progress: None,
        });
    }

    // `0.0..=1.0` scaled by 100 and rounded is a whole number; it is parsed
    // rather than cast so the crate's no-lossy-`as` rule holds.
    let percent = (progress * 100.0).round();
    let percent = percent.to_string().parse::<u64>().map_err(|error| {
        WireError::new(
            "invalid_message",
            format!("progress {progress} is not a whole percentage: {error}"),
        )
    })?;

    Ok(ProgressBarState {
        status: Some(ProgressBarStatus::Normal),
        progress: Some(percent),
    })
}

/// Parses the `#rgb`/`#rrggbb`/`#rrggbbaa` colours Electron accepts.
///
/// The sidecar passes literal hex strings (`window-manager.ts` uses `#1c1c1c`,
/// `#0a0a0a` and `#00000000`). Anything else is logged and ignored rather than
/// guessed, because a wrong window colour is worse than the platform default.
fn color_from_hex(value: &str) -> Option<Color> {
    let hex = value.strip_prefix('#')?;

    let channel = |range: std::ops::Range<usize>| -> Option<u8> {
        u8::from_str_radix(hex.get(range)?, 16).ok()
    };

    let (red, green, blue, alpha) = match hex.len() {
        6 => (channel(0..2)?, channel(2..4)?, channel(4..6)?, 255),
        8 => (
            channel(0..2)?,
            channel(2..4)?,
            channel(4..6)?,
            channel(6..8)?,
        ),
        _ => return None,
    };

    Some(Color(red, green, blue, alpha))
}

/// Labels whose windows load the Sphinx renderer and therefore receive the
/// capability set in `src-tauri/capabilities/default.json`.
///
/// They must stay on the app bundle or the development server: a remote page
/// cannot reach IPC today because no capability declares `remote.urls`, but
/// keeping the two apart means adding one later cannot hand a provider page the
/// shell's API by accident.
fn is_renderer_label(label: &str) -> bool {
    matches!(
        label,
        "main"
            | "big-picture"
            | "friends"
            | "chat"
            | "retroachievements-connection"
            | "game-launcher"
    ) || label.starts_with("theme-editor-")
}

/// Whether a renderer window may load `url`.
///
/// App-relative paths (`index.html#/big-picture`) are always fine. An external
/// URL is only accepted when its origin matches `devUrl`: that is the Vite
/// server the sidecar builds renderer routes from in development. Auth windows
/// (Epic, Steam) use generated labels instead, so they are not affected.
fn renderer_url_allowed(url: &str, dev_url: Option<&str>) -> bool {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return true;
    }

    let (Ok(target), Some(dev_url)) = (url.parse::<tauri::Url>(), dev_url) else {
        return false;
    };

    match dev_url.parse::<tauri::Url>() {
        Ok(dev_url) => target.origin() == dev_url.origin(),
        Err(_) => false,
    }
}

/// Maps the URL the sidecar sends to a `WebviewUrl`.
///
/// External `http(s)` URLs are kept as they are. Anything else is an app path
/// that may carry a fragment (`index.html#/big-picture`), so the path and the
/// fragment are kept together: the fragment is what selects the renderer route.
fn webview_url_for(url: &str) -> Result<WebviewUrl, WireError> {
    if url.starts_with("http://") || url.starts_with("https://") {
        let parsed = url
            .parse()
            .map_err(|error| WireError::new("invalid_url", format!("{url}: {error}")))?;
        return Ok(WebviewUrl::External(parsed));
    }

    Ok(WebviewUrl::App(PathBuf::from(url.trim_start_matches('/'))))
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

    if is_renderer_label(&label)
        && !renderer_url_allowed(
            &url,
            app.config().build.dev_url.as_ref().map(tauri::Url::as_str),
        )
    {
        return Err(WireError::new(
            "invalid_url",
            format!("{label} may only load the app bundle or the development server, not {url}"),
        ));
    }

    if app.get_webview_window(&label).is_some() {
        return Ok(json!({ "windowId": 0, "existing": true }));
    }

    let webview_url = webview_url_for(&url)?;

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

    if let Some(width) = number_param(&options, "maxWidth") {
        if let Some(height) = number_param(&options, "maxHeight") {
            builder = builder.max_inner_size(width, height);
        }
    }

    if let (Some(x), Some(y)) = (number_param(&options, "x"), number_param(&options, "y")) {
        builder = builder.position(x, y);
    }

    builder = builder
        .minimizable(bool_param(&options, "minimizable", true))
        .maximizable(bool_param(&options, "maximizable", true))
        .focusable(bool_param(&options, "focusable", true));

    if let Some(background) = options.get("backgroundColor").and_then(Value::as_str) {
        match color_from_hex(background) {
            Some(color) => builder = builder.background_color(color),
            None => {
                eprintln!("[rpc] window.create: ignoring malformed backgroundColor {background}")
            }
        }
    }

    // macOS only: Windows and Linux windows either keep the native frame or draw
    // their own, and the sidecar already passes `frame: false` for those.
    #[cfg(target_os = "macos")]
    if let Some(style) = options.get("titleBarStyle").and_then(Value::as_str) {
        let style = match style {
            "hidden" | "hiddenInset" => tauri::TitleBarStyle::Overlay,
            "default" => tauri::TitleBarStyle::Visible,
            other => {
                eprintln!("[rpc] window.create: unknown titleBarStyle {other}");
                tauri::TitleBarStyle::Visible
            }
        };
        builder = builder.title_bar_style(style);
    }

    if let Some(path) = options.get("icon").and_then(Value::as_str) {
        match Image::from_path(path) {
            Ok(icon) => {
                builder = builder.icon(icon).map_err(|error| {
                    WireError::new("window_failed", format!("cannot use icon {path}: {error}"))
                })?;
            }
            Err(error) => {
                eprintln!("[rpc] window.create: cannot load icon {path}: {error}");
            }
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

    builder.build().map_err(|error| {
        WireError::new("window_failed", format!("cannot create {label}: {error}"))
    })?;

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
        "setFullScreen" => ok(window.set_fullscreen(bool_param(&call_params, "fullscreen", false))),
        "setAlwaysOnTop" => {
            ok(window.set_always_on_top(bool_param(&call_params, "alwaysOnTop", false)))
        }
        "setIgnoreMouseEvents" => {
            ok(window.set_ignore_cursor_events(bool_param(&call_params, "ignore", false)))
        }
        "setSkipTaskbar" => ok(window.set_skip_taskbar(bool_param(&call_params, "skip", false))),
        "setTitle" => ok(window.set_title(&string_param(&call_params, "title")?)),
        "setBounds" => {
            let width = number_param(&call_params, "width");
            let height = number_param(&call_params, "height");
            let x = number_param(&call_params, "x");
            let y = number_param(&call_params, "y");

            if let (Some(width), Some(height)) = (width, height) {
                if let Err(error) = window.set_size(tauri::LogicalSize::new(width, height)) {
                    eprintln!("[rpc] window.setBounds: cannot set the size: {error}");
                }
            }
            if let (Some(x), Some(y)) = (x, y) {
                if let Err(error) = window.set_position(tauri::LogicalPosition::new(x, y)) {
                    eprintln!("[rpc] window.setBounds: cannot set the position: {error}");
                }
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
        "setFocusable" => ok(window.set_focusable(bool_param(&call_params, "focusable", true))),
        "setProgressBar" => {
            let progress = number_param(&call_params, "progress").unwrap_or(-1.0);
            ok(window.set_progress_bar(progress_bar_state(progress)?))
        }
        "setOpacity" => {
            // Tauri v2 has no per-window opacity. The only caller
            // (`window-manager.ts`) uses the ends of the range: 0 hides the main
            // window while Big Picture opens, 1 brings it back. Intermediate
            // values have no faithful mapping, so they are reported instead of
            // approximated.
            let opacity = number_param(&call_params, "opacity").unwrap_or(1.0);
            if opacity <= 0.0 {
                ok(window.hide())
            } else if opacity < 1.0 {
                Err(WireError::new(
                    "not_implemented",
                    format!("partial window opacity ({opacity}) has no Tauri v2 equivalent"),
                ))
            } else {
                let visible = window
                    .is_visible()
                    .map_err(|error| WireError::new("window_failed", error.to_string()))?;
                if visible {
                    Ok(Value::Null)
                } else {
                    ok(window.show())
                }
            }
        }
        other => Err(WireError::new(
            "not_implemented",
            format!("window.{other} is not implemented by the shell"),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app_path(url: &str) -> String {
        match webview_url_for(url) {
            Ok(WebviewUrl::App(path)) => path.to_string_lossy().to_string(),
            _ => String::from("<not an app url>"),
        }
    }

    #[test]
    fn app_route_keeps_its_fragment() {
        assert_eq!(
            app_path("index.html#/big-picture"),
            "index.html#/big-picture"
        );
    }

    #[test]
    fn leading_slash_is_stripped_and_query_kept() {
        assert_eq!(
            app_path("/theme-editor?themeId=abc"),
            "theme-editor?themeId=abc"
        );
    }

    #[test]
    fn https_urls_stay_external() {
        assert!(matches!(
            webview_url_for("https://example.test/x"),
            Ok(WebviewUrl::External(_))
        ));
    }

    #[test]
    fn malformed_external_url_is_rejected() {
        assert!(webview_url_for("https://[bad").is_err());
    }

    fn dev_url() -> &'static str {
        "http://localhost:5173"
    }

    #[test]
    fn renderer_labels_include_the_capability_windows() {
        for label in [
            "main",
            "big-picture",
            "friends",
            "chat",
            "retroachievements-connection",
            "game-launcher",
            "theme-editor-3",
        ] {
            assert!(is_renderer_label(label), "{label} is a renderer window");
        }

        for label in ["sphinx-window-1", "epic-auth", "steam-auth"] {
            assert!(!is_renderer_label(label), "{label} is an external window");
        }
    }

    #[test]
    fn renderer_windows_accept_app_paths() {
        assert!(renderer_url_allowed("index.html#/friends", None));
        assert!(renderer_url_allowed("/theme-editor?themeId=abc", None));
    }

    #[test]
    fn renderer_windows_accept_the_development_server() {
        assert!(renderer_url_allowed(
            "http://localhost:5173#/big-picture",
            Some(dev_url())
        ));
    }

    #[test]
    fn renderer_windows_reject_other_remote_origins() {
        assert!(!renderer_url_allowed(
            "https://evil.test/#/friends",
            Some(dev_url())
        ));
    }

    #[test]
    fn renderer_windows_reject_remote_urls_without_a_dev_server() {
        assert!(!renderer_url_allowed(
            "http://localhost:5173#/friends",
            None
        ));
    }

    #[test]
    fn renderer_windows_compare_origins_not_paths() {
        assert!(renderer_url_allowed(
            "http://localhost:5173/some/other/path?x=1#/chat",
            Some(dev_url())
        ));
    }

    #[test]
    fn negative_progress_removes_the_taskbar_bar() {
        assert!(matches!(
            progress_bar_state(-1.0),
            Ok(ProgressBarState {
                status: Some(ProgressBarStatus::None),
                progress: None,
            })
        ));
    }

    #[test]
    fn ratio_progress_becomes_whole_percent() {
        assert!(matches!(
            progress_bar_state(0.425),
            Ok(ProgressBarState {
                status: Some(ProgressBarStatus::Normal),
                progress: Some(43),
            })
        ));
    }

    #[test]
    fn progress_above_one_is_indeterminate() {
        assert!(matches!(
            progress_bar_state(1.5),
            Ok(ProgressBarState {
                status: Some(ProgressBarStatus::Indeterminate),
                progress: None,
            })
        ));
    }

    #[test]
    fn non_finite_progress_is_rejected() {
        assert!(progress_bar_state(f64::NAN).is_err());
        assert!(progress_bar_state(f64::INFINITY).is_err());
    }

    #[test]
    fn hex_colours_are_parsed_with_optional_alpha() {
        assert_eq!(
            color_from_hex("#1c1c1c"),
            Some(Color(0x1c, 0x1c, 0x1c, 0xff))
        );
        assert_eq!(
            color_from_hex("#0A0A0A00"),
            Some(Color(0x0a, 0x0a, 0x0a, 0x00))
        );
    }

    #[test]
    fn malformed_colours_are_rejected() {
        for value in ["1c1c1c", "#12", "#gggggg", "#1234567"] {
            assert_eq!(color_from_hex(value), None, "{value} should not parse");
        }
    }
}
