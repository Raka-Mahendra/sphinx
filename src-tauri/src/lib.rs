//! Sphinx Launcher — Tauri v2 shell.
//!
//! Responsibilities, in the order they happen:
//!
//! 1. create the main window exactly as the Electron baseline did (Fase 3);
//! 2. start the Node sidecar supervisor, which owns `src/main`;
//! 3. forward renderer IPC to the sidecar through a generated allowlist;
//! 4. serve the sidecar's own requests (dialogs, shell, keychain, paths,
//!    windows, tray, notifications, autostart, updates);
//! 5. own the OS surfaces Electron used to own: single instance, deep links,
//!    tray, and the update installer;
//! 6. shut the sidecar down in order when the app exits.
//!
//! Nothing here talks to the network or the filesystem on the renderer's behalf
//! except through the sidecar, so the trust boundary is one place.

pub mod clipboard;
pub mod dialogs;
pub mod ipc;
pub mod keychain;
pub mod notifications;
pub mod platform;
pub mod power;
pub mod shell;
pub mod tray;
pub mod updater;
pub mod uri_scheme;
pub mod sidecar;

use std::sync::Arc;

use tauri::webview::PageLoadEvent;
use tauri::{Manager, RunEvent};

/// Default and minimum sizes copied from the Electron baseline
/// (`src/main/services/window-manager.ts:108-142`).
const MAIN_WINDOW_WIDTH: f64 = 1200.0;
const MAIN_WINDOW_HEIGHT: f64 = 860.0;
const MAIN_WINDOW_MIN_WIDTH: f64 = 1024.0;
const MAIN_WINDOW_MIN_HEIGHT: f64 = 600.0;

/// How long the sidecar gets to stop cleanly before it is killed.
const SHUTDOWN_TIMEOUT_MS: u64 = 8_000;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // The single-instance plugin must be registered first so a second launch
    // never reaches the rest of the setup.
    // Source: https://v2.tauri.app/plugin/deep-linking/#single-instance
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        platform::handle_second_instance(app, &argv);
    }));

    let built = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            // The flag is fixed at build time, so "start minimised" is stored
            // separately and read at startup (`platform::compute_startup`).
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Rust-side dialog use does not need a capability entry; the plugin is
        // registered so `dialog.*` RPC methods have a native implementation.
        .plugin(tauri_plugin_dialog::init())
        // `local:` artwork. The scheme name is rewritten to
        // `http://local.localhost/...` by the webview, so the bridge converts
        // URLs at the DOM boundary; see `src-tauri/src/uri_scheme.rs`.
        .register_uri_scheme_protocol("local", |app, request| {
            uri_scheme::handle_local(app, request)
        })
        .invoke_handler(tauri::generate_handler![
            ipc::commands::ipc_invoke,
            ipc::commands::ipc_send,
            ipc::commands::sidecar_restart,
            ipc::commands::sidecar_status,
        ])
        // The Electron baseline shows the window on `ready-to-show` to avoid a
        // white flash. Tauri's documented equivalent is the page-load hook.
        // Source: https://docs.rs/tauri/latest/tauri/struct.Builder.html#method.on_page_load
        .on_page_load(|webview, payload| {
            if payload.event() != PageLoadEvent::Finished {
                return;
            }

            // An autostart launch with "start minimised" stays hidden, exactly
            // like `index.ts:205` skipping `createMainWindow`.
            if webview.label() == "main" {
                let hidden = webview
                    .app_handle()
                    .try_state::<platform::Startup>()
                    .map(|startup| startup.hidden)
                    .unwrap_or(false);

                if hidden {
                    return;
                }
            }

            if let Some(window) = webview.get_webview_window(webview.label()) {
                if let Err(error) = window.show() {
                    eprintln!("failed to show window after load: {error}");
                }
            }
        })
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_size(tauri::LogicalSize::new(
                    MAIN_WINDOW_WIDTH,
                    MAIN_WINDOW_HEIGHT,
                ));
                let _ = window.set_min_size(Some(tauri::LogicalSize::new(
                    MAIN_WINDOW_MIN_WIDTH,
                    MAIN_WINDOW_MIN_HEIGHT,
                )));
            }

            let handle = app.handle().clone();

            app.manage(platform::compute_startup(&handle));
            app.manage(updater::UpdaterState::default());

            let config = match sidecar::config::build_config(&handle) {
                Ok(config) => config,
                Err(error) => {
                    // The window still opens; it will show "background service
                    // unavailable" instead of a blank screen.
                    eprintln!("[shell] cannot configure the sidecar: {error}");
                    return Ok(());
                }
            };

            let supervisor = sidecar::Supervisor::new(handle.clone(), config);
            app.manage(ipc::AppState {
                supervisor: Arc::clone(&supervisor),
            });

            tray::register_menu_handler(&handle, Arc::clone(&supervisor));
            platform::register_deep_links(&handle, Arc::clone(&supervisor));

            supervisor.start();

            Ok(())
        })
        .build(tauri::generate_context!());

    let app = match built {
        Ok(app) => app,
        Err(error) => {
            eprintln!("failed to build Sphinx Launcher: {error}");
            std::process::exit(1);
        }
    };

    app.run(|handle, event| {
        if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
            let Some(state) = handle.try_state::<ipc::AppState>() else {
                return;
            };

            // Blocking on purpose: this is the exit path, and returning before
            // the sidecar has closed LevelDB would leave the lock held for the
            // next start.
            tauri::async_runtime::block_on(async {
                state.supervisor.shutdown(SHUTDOWN_TIMEOUT_MS).await;
            });
        }
    });
}
