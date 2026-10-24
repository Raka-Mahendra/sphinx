use tauri_build::AppManifest;

/// The commands the shell exposes.
///
/// Listing them in the app manifest is what turns on per-window command gating.
/// Quoting the Tauri v2 documentation on capabilities
/// (<https://v2.tauri.app/security/capabilities/>):
///
/// > "By default, all commands that you registered in your app (using the
/// > `tauri::Builder::invoke_handler` function) are allowed to be used by all
/// > the windows and webviews of the app. To change that, consider using
/// > `AppManifest::commands`."
///
/// With the manifest in place, `src-tauri/capabilities/default.json` decides
/// which windows may call each command, and a window that is not listed is
/// rejected by Tauri's core before the command body runs.
fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            AppManifest::new().commands(&[
                "ipc_invoke",
                "ipc_send",
                "sidecar_restart",
                "sidecar_status",
            ]),
        ),
    )
    .expect("failed to build the Tauri app manifest");
}
