//! Where the sidecar binary, its script, and its environment come from.
//!
//! The PRD pins Node LTS as an `externalBin` and passes resolved paths into the
//! sidecar, so the Node process never guesses a location:
//!
//! - packaged: `node` and `sidecar/index.mjs` live next to the app resources;
//! - development: `node` comes from `PATH` (or `SPHINX_NODE_BINARY`) and the
//!   script is the esbuild output in `out/sidecar`.
//!
//! Every path handed to the sidecar is absolute and exists at spawn time; a
//! missing one is a hard error instead of a sidecar that starts and then fails
//! on its first `app.getPath`.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

#[derive(Debug, Clone)]
pub struct SidecarConfig {
    pub node: PathBuf,
    pub script: PathBuf,
    pub working_dir: PathBuf,
    pub env: Vec<(String, String)>,
    pub is_packaged: bool,
}

fn project_root() -> PathBuf {
    // `CARGO_MANIFEST_DIR` is `<repo>/src-tauri`, so the repo root is its parent.
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn node_binary(is_packaged: bool, resources: &Path) -> PathBuf {
    if let Ok(explicit) = std::env::var("SPHINX_NODE_BINARY") {
        if !explicit.is_empty() {
            return PathBuf::from(explicit);
        }
    }

    if is_packaged {
        let name = if cfg!(windows) { "node.exe" } else { "node" };

        // `bundle.externalBin: ["binaries/node"]` puts the binary next to the
        // executable (Tauri strips the triple from the file name), so that is
        // the first place to look. `<resources>/node/` is the older layout and
        // stays as a fallback so a hand-assembled bundle still starts.
        let candidates = [
            std::env::current_exe()
                .ok()
                .and_then(|exe| exe.parent().map(|dir| dir.join(name))),
            Some(resources.join("node").join(name)),
        ];

        for candidate in candidates.into_iter().flatten() {
            if candidate.exists() {
                return candidate;
            }
        }
    }

    PathBuf::from(if cfg!(windows) { "node.exe" } else { "node" })
}

fn resolve_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf, bool), String> {
    let is_packaged = !tauri::is_dev();

    let resources = if is_packaged {
        app.path()
            .resource_dir()
            .map_err(|error| format!("cannot resolve the resource directory: {error}"))?
    } else {
        project_root().join("resources")
    };

    Ok((resources, project_root(), is_packaged))
}

/// Resolves a file inside the bundled resources directory.
///
/// Packaged: `<resources>/<name>`; development: `<repo>/resources/<name>`. Used
/// by the tray (icon files) and the notification builder (notification icon),
/// both of which live outside the sidecar.
pub fn resolve_resource(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let (resources, _, _) = resolve_paths(app)?;
    Ok(resources.join(name))
}

/// Electron's `app.getPath` names, resolved once and handed to the sidecar as
/// JSON. The sidecar reads them synchronously while its module graph loads, so
/// they cannot be an RPC round trip.
fn path_map(app: &AppHandle) -> Result<String, String> {
    use tauri::path::BaseDirectory;

    let mut map = serde_json::Map::new();

    let entries: [(&str, BaseDirectory); 8] = [
        ("home", BaseDirectory::Home),
        ("appData", BaseDirectory::AppData),
        ("appConfig", BaseDirectory::AppConfig),
        ("appLocalData", BaseDirectory::AppLocalData),
        ("temp", BaseDirectory::Temp),
        ("desktop", BaseDirectory::Desktop),
        ("documents", BaseDirectory::Document),
        ("downloads", BaseDirectory::Download),
    ];

    for (name, directory) in entries {
        if let Ok(path) = app.path().resolve("", directory) {
            map.insert(
                name.to_string(),
                serde_json::Value::String(path.to_string_lossy().to_string()),
            );
        }
    }

    let user_data = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("cannot resolve the app data directory: {error}"))?;

    let user_data_string = user_data.to_string_lossy().to_string();

    for alias in ["userData", "sessionData", "userCache", "crashDumps"] {
        map.insert(
            alias.to_string(),
            serde_json::Value::String(match alias {
                "userData" => user_data_string.clone(),
                "sessionData" => user_data_string.clone(),
                "userCache" => user_data.join("Cache").to_string_lossy().to_string(),
                _ => user_data.join("Crashpad").to_string_lossy().to_string(),
            }),
        );
    }

    map.insert(
        "logs".to_string(),
        serde_json::Value::String(user_data.join("logs").to_string_lossy().to_string()),
    );
    map.insert(
        "exe".to_string(),
        serde_json::Value::String(
            std::env::current_exe()
                .map(|path| path.to_string_lossy().to_string())
                .unwrap_or_default(),
        ),
    );
    map.insert(
        "module".to_string(),
        serde_json::Value::String(
            std::env::current_dir()
                .map(|path| path.to_string_lossy().to_string())
                .unwrap_or_default(),
        ),
    );

    serde_json::to_string(&map).map_err(|error| format!("cannot serialise the path map: {error}"))
}

/// Displays, in the shape the shim's `screen` object expects. `window-manager`
/// uses them synchronously for window placement, so they cannot be an RPC call
/// either.
fn display_map(app: &AppHandle) -> String {
    let mut displays = Vec::new();

    if let Ok(monitors) = app.available_monitors() {
        for (index, monitor) in monitors.iter().enumerate() {
            let position = monitor.position();
            let size = monitor.size();
            let scale = monitor.scale_factor();

            displays.push(serde_json::json!({
                "id": index,
                "bounds": {
                    "x": position.x,
                    "y": position.y,
                    "width": size.width,
                    "height": size.height,
                },
                "workArea": {
                    "x": position.x,
                    "y": position.y,
                    "width": size.width,
                    "height": size.height,
                },
                "scaleFactor": scale,
            }));
        }
    }

    serde_json::to_string(&displays).unwrap_or_else(|_| "[]".to_string())
}

pub fn build_config(app: &AppHandle) -> Result<SidecarConfig, String> {
    let (resources, root, is_packaged) = resolve_paths(app)?;

    let script = if is_packaged {
        resources.join("sidecar").join("index.mjs")
    } else {
        root.join("out").join("sidecar").join("index.mjs")
    };

    if !script.exists() {
        return Err(format!(
            "the sidecar bundle is missing at {}; run `yarn build:sidecar`",
            script.display()
        ));
    }

    let version = app.package_info().version.to_string();
    let paths = path_map(app)?;
    let displays = display_map(app);

    let env = vec![
        ("SPHINX_IS_PACKAGED".to_string(), if is_packaged { "1" } else { "0" }.to_string()),
        ("SPHINX_APP_VERSION".to_string(), version),
        ("SPHINX_APP_NAME".to_string(), "Sphinx Launcher".to_string()),
        ("SPHINX_APP_PATH".to_string(), root.to_string_lossy().to_string()),
        (
            "SPHINX_RESOURCES_DIR".to_string(),
            resources.to_string_lossy().to_string(),
        ),
        ("SPHINX_PATHS".to_string(), paths),
        ("SPHINX_DISPLAYS".to_string(), displays),
        ("SPHINX_SUPERVISED".to_string(), "1".to_string()),
        (
            "SPHINX_RENDERER_URL".to_string(),
            if is_packaged {
                String::new()
            } else {
                std::env::var("SPHINX_RENDERER_URL")
                    .unwrap_or_else(|_| "http://localhost:5173".to_string())
            },
        ),
    ];

    Ok(SidecarConfig {
        node: node_binary(is_packaged, &resources),
        script,
        working_dir: root,
        env,
        is_packaged,
    })
}

/// Resolves one of Electron's `app.getPath` names for the `path.get` RPC.
///
/// The boot-time set is passed as `SPHINX_PATHS`; this covers the names that are
/// only needed later and that Tauri can resolve on demand.
pub fn resolve_named_path(app: &AppHandle, name: &str) -> Result<String, super::protocol::WireError> {
    use super::protocol::WireError;
    use tauri::path::BaseDirectory;

    let base = match name {
        "home" => Some(BaseDirectory::Home),
        "appData" => Some(BaseDirectory::AppData),
        "appConfig" => Some(BaseDirectory::AppConfig),
        "appLocalData" => Some(BaseDirectory::AppLocalData),
        "temp" => Some(BaseDirectory::Temp),
        "desktop" => Some(BaseDirectory::Desktop),
        "documents" => Some(BaseDirectory::Document),
        "downloads" => Some(BaseDirectory::Download),
        _ => None,
    };

    if let Some(directory) = base {
        let path = app
            .path()
            .resolve("", directory)
            .map_err(|error| WireError::new("path_unavailable", error.to_string()))?;
        return Ok(path.to_string_lossy().to_string());
    }

    match name {
        "userData" | "sessionData" => app
            .path()
            .app_data_dir()
            .map(|path| path.to_string_lossy().to_string())
            .map_err(|error| WireError::new("path_unavailable", error.to_string())),
        "logs" => app
            .path()
            .app_data_dir()
            .map(|path| path.join("logs").to_string_lossy().to_string())
            .map_err(|error| WireError::new("path_unavailable", error.to_string())),
        "crashDumps" => app
            .path()
            .app_data_dir()
            .map(|path| path.join("Crashpad").to_string_lossy().to_string())
            .map_err(|error| WireError::new("path_unavailable", error.to_string())),
        "userCache" => app
            .path()
            .app_data_dir()
            .map(|path| path.join("Cache").to_string_lossy().to_string())
            .map_err(|error| WireError::new("path_unavailable", error.to_string())),
        "exe" => Ok(std::env::current_exe()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default()),
        other => Err(WireError::new(
            "path_unavailable",
            format!("unknown path name: {other}"),
        )),
    }
}
