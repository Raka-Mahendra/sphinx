//! In-app updates.
//!
//! Rust owns the update state; the sidecar's `UpdateManager` is a thin client
//! over three RPC methods and reshapes the results into the baseline's
//! `autoUpdaterEvent` payloads. That split is the PRD's (§4.E): the shell is the
//! only place that may install anything, and the sidecar stays the only place
//! that decides when to ask.
//!
//! Two-stage UX, as in the baseline:
//!   1. `update_check` → sidecar emits `{ type: "update-available", info }`
//!   2. `update_download` → sidecar emits `{ type: "update-downloaded" }`
//! then `update_install` runs the installer.
//!
//! Sources:
//! - plugin guide: <https://v2.tauri.app/plugin/updater/>
//! - `Update::download/install`: <https://docs.rs/tauri-plugin-updater/latest/tauri_plugin_updater/struct.Update.html>
//! - `UpdaterBuilder::on_before_exit`: <https://docs.rs/tauri-plugin-updater/latest/tauri_plugin_updater/struct.UpdaterBuilder.html>
//!
//! Note on Windows: `Update::install` spawns the installer and exits the app
//! (`std::process::exit(0)`), which is why the sidecar has to be down *before*
//! that call. `on_before_exit` is the documented hook for exactly this.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::ipc::AppState;
use crate::sidecar::protocol::WireError;
use crate::sidecar::Supervisor;

/// How long the sidecar gets to stop before the installer runs.
///
/// Generous on purpose: a running torrent needs to flush resume data, and a
/// half-written `.resume` file costs the user a full re-check on next start.
const SHUTDOWN_TIMEOUT_MS: u64 = 12_000;

/// Progress events are throttled to this interval; a 100 MB download otherwise
/// produces thousands of IPC lines.
const PROGRESS_INTERVAL_MS: u64 = 250;

#[derive(Default)]
pub struct UpdaterState {
    pending: Mutex<Option<Update>>,
    downloaded: Mutex<Option<Vec<u8>>>,
    phase: Mutex<Phase>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Idle,
    Checking,
    Available,
    Downloading,
    Downloaded,
    Installing,
}

impl Default for Phase {
    fn default() -> Self {
        Phase::Idle
    }
}

impl Phase {
    fn as_str(self) -> &'static str {
        match self {
            Phase::Idle => "idle",
            Phase::Checking => "checking",
            Phase::Available => "available",
            Phase::Downloading => "downloading",
            Phase::Downloaded => "downloaded",
            Phase::Installing => "installing",
        }
    }
}

fn set_phase(state: &UpdaterState, phase: Phase) {
    if let Ok(mut current) = state.phase.lock() {
        *current = phase;
    }
}

fn phase(state: &UpdaterState) -> Phase {
    state.phase.lock().map(|phase| *phase).unwrap_or(Phase::Idle)
}

/// Builds an updater with the before-exit hook attached.
///
/// Every path that can reach `install()` must come from this function, or the
/// sidecar would still be running when the installer replaces its files.
fn build_updater(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, WireError> {
    let handle = app.clone();

    app.updater_builder()
        .on_before_exit(move || {
            // `on_before_exit` is `Fn()`, and blocking the runtime thread would
            // panic if this runs inside it. A short-lived thread keeps the
            // blocking shutdown legal.
            let handle = handle.clone();
            let joined = std::thread::spawn(move || {
                tauri::async_runtime::block_on(shutdown_before_install(&handle));
            })
            .join();

            if joined.is_err() {
                eprintln!("[updater] before-exit shutdown thread panicked");
            }
        })
        .build()
        .map_err(|error| WireError::new("updater_unavailable", error.to_string()))
}

/// Stops everything that could hold a file the installer replaces.
///
/// The sidecar owns the torrent engine, LevelDB and the Epic/legendary process,
/// so it gets a normal shutdown RPC first — the same sequence a user quit runs,
/// including `torrentShutdown`. Only after the process is reaped does the
/// installer run, which is what keeps `node.exe` and `hydra-native.node` from
/// being locked.
async fn shutdown_before_install(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };

    state.supervisor.shutdown(SHUTDOWN_TIMEOUT_MS).await;

    // A game that is already running is a detached process, not a child of the
    // sidecar, so nothing here can or should stop it.
}

/// `autoUpdater.checkForUpdates()`.
pub async fn check(
    app: &AppHandle,
    _supervisor: &Arc<Supervisor>,
    state: &UpdaterState,
) -> Result<Value, WireError> {
    set_phase(state, Phase::Checking);

    let updater = build_updater(app)?;

    let update = updater
        .check()
        .await
        .map_err(|error| WireError::new("update_check_failed", error.to_string()))?;

    let Some(update) = update else {
        set_phase(state, Phase::Idle);
        return Ok(json!({ "available": false }));
    };

    let response = json!({
        "available": true,
        "version": update.version,
        "currentVersion": update.current_version,
        "notes": update.body,
        // The baseline's `checkForUpdates()` resolved to this flag and the UI
        // used it to choose between a download link and an install button.
        // Portable builds are gone (§4.E), so a packaged app can always
        // self-install.
        "autoInstallAvailable": !tauri::is_dev(),
    });

    if let Ok(mut pending) = state.pending.lock() {
        *pending = Some(update);
    }
    set_phase(state, Phase::Available);

    Ok(response)
}

/// `autoUpdater.downloadUpdate()`.
pub async fn download(
    _app: &AppHandle,
    supervisor: &Arc<Supervisor>,
    state: &UpdaterState,
) -> Result<Value, WireError> {
    let update = state
        .pending
        .lock()
        .ok()
        .and_then(|pending| pending.clone())
        .ok_or_else(|| WireError::new("update_not_available", "no update has been checked"))?;

    set_phase(state, Phase::Downloading);

    let progress = Arc::new(AtomicU64::new(0));
    let last_emit = Arc::new(AtomicU64::new(0));
    let progress_supervisor = Arc::clone(supervisor);
    let progress_counter = Arc::clone(&progress);
    let progress_last = Arc::clone(&last_emit);

    let bytes = update
        .download(
            move |chunk_length, content_length| {
                let total = progress_counter.fetch_add(chunk_length as u64, Ordering::Relaxed)
                    + chunk_length as u64;

                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|elapsed| elapsed.as_millis() as u64)
                    .unwrap_or(0);

                let previous = progress_last.load(Ordering::Relaxed);
                if now.saturating_sub(previous) < PROGRESS_INTERVAL_MS {
                    return;
                }
                progress_last.store(now, Ordering::Relaxed);

                let supervisor = Arc::clone(&progress_supervisor);
                tauri::async_runtime::spawn(async move {
                    supervisor
                        .announce_update_progress(total, content_length)
                        .await;
                });
            },
            || {},
        )
        .await
        .map_err(|error| WireError::new("update_download_failed", error.to_string()))?;

    if let Ok(mut downloaded) = state.downloaded.lock() {
        *downloaded = Some(bytes);
    }
    set_phase(state, Phase::Downloaded);

    Ok(json!({ "downloaded": true }))
}

/// `autoUpdater.quitAndInstall()`.
///
/// On Windows this spawns the installer and exits the process; the sidecar is
/// stopped by the `on_before_exit` hook registered in `build_updater`.
pub async fn install(app: &AppHandle, state: &UpdaterState) -> Result<Value, WireError> {
    let update = state
        .pending
        .lock()
        .ok()
        .and_then(|pending| pending.clone())
        .ok_or_else(|| WireError::new("update_not_available", "no update has been checked"))?;

    let bytes = state
        .downloaded
        .lock()
        .ok()
        .and_then(|mut downloaded| downloaded.take())
        .ok_or_else(|| {
            WireError::new("update_not_downloaded", "the update has not been downloaded")
        })?;

    set_phase(state, Phase::Installing);

    // Rebuilds the updater so the before-exit hook is attached to *this* call.
    // `install()` consumes the bytes and verifies them again before running.
    let _ = build_updater(app)?;

    update
        .install(bytes)
        .map_err(|error| WireError::new("update_install_failed", error.to_string()))?;

    // macOS and Linux return here; Windows never does.
    Ok(json!({ "installed": true }))
}

/// `updater.state` — what the sidecar needs to answer the UI without guessing.
pub fn state_snapshot(state: &UpdaterState) -> Value {
    json!({ "phase": phase(state).as_str() })
}
