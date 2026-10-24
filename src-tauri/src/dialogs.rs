//! `dialog.*` RPC methods.
//!
//! The return shapes are the ones `src/main` already expects from Electron:
//! `{ canceled, filePaths }` for open/save and `{ response }` for message boxes.
//! Keeping them identical is what lets `events/misc/show-open-dialog.ts` and the
//! cloud-save path pickers work without changes.

use std::path::PathBuf;

use serde_json::{json, Value};
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::sidecar::protocol::WireError;

fn title(params: &Value) -> String {
    params
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Sphinx Launcher")
        .to_string()
}

fn filters(params: &Value) -> Vec<(String, Vec<String>)> {
    let Some(list) = params.get("filters").and_then(Value::as_array) else {
        return Vec::new();
    };

    list.iter()
        .filter_map(|filter| {
            let name = filter.get("name").and_then(Value::as_str)?.to_string();
            let extensions: Vec<String> = filter
                .get("extensions")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();

            Some((name, extensions))
        })
        .collect()
}

fn wants_directories(params: &Value) -> bool {
    params
        .get("properties")
        .and_then(Value::as_array)
        .map(|items| items.iter().any(|item| item == "openDirectory"))
        .unwrap_or(false)
}

fn allows_multiple(params: &Value) -> bool {
    params
        .get("properties")
        .and_then(Value::as_array)
        .map(|items| items.iter().any(|item| item == "multiSelections"))
        .unwrap_or(false)
}

/// `tauri_plugin_dialog::FilePath` is either a local path or a URL. Only local
/// paths are meaningful for the open/save dialogs this app uses, so a URL that
/// slips through becomes an empty path instead of panicking.
fn to_pathbuf(path: tauri_plugin_dialog::FilePath) -> PathBuf {
    path.into_path().unwrap_or_default()
}

fn as_strings(paths: Vec<PathBuf>) -> Vec<String> {
    paths
        .into_iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect()
}

pub async fn open(app: &AppHandle, params: &Value) -> Result<Value, WireError> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let mut builder = app.dialog().file().set_title(title(params));

    for (name, extensions) in filters(params) {
        let refs: Vec<&str> = extensions.iter().map(String::as_str).collect();
        builder = builder.add_filter(name, &refs);
    }

    if let Some(directory) = params.get("defaultPath").and_then(Value::as_str) {
        builder = builder.set_directory(directory);
    }

    if wants_directories(params) {
        builder.pick_folder(move |folder| {
            let _ = sender.send(folder.map(|path| vec![to_pathbuf(path)]));
        });
    } else if allows_multiple(params) {
        builder.pick_files(move |files| {
            let _ = sender.send(
                files.map(|list| list.into_iter().map(to_pathbuf).collect::<Vec<_>>()),
            );
        });
    } else {
        builder.pick_file(move |file| {
            let _ = sender.send(file.map(|path| vec![to_pathbuf(path)]));
        });
    }

    let selection = receiver.await.map_err(|error| {
        WireError::new("dialog_failed", format!("the dialog was dropped: {error}"))
    })?;

    match selection {
        Some(paths) if !paths.is_empty() => Ok(json!({
            "canceled": false,
            "filePaths": as_strings(paths),
        })),
        _ => Ok(json!({ "canceled": true, "filePaths": [] })),
    }
}

pub async fn save(app: &AppHandle, params: &Value) -> Result<Value, WireError> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let mut builder = app.dialog().file().set_title(title(params));

    for (name, extensions) in filters(params) {
        let refs: Vec<&str> = extensions.iter().map(String::as_str).collect();
        builder = builder.add_filter(name, &refs);
    }

    if let Some(name) = params.get("defaultPath").and_then(Value::as_str) {
        builder = builder.set_file_name(name);
    }

    builder.save_file(move |file| {
        let _ = sender.send(file.map(to_pathbuf));
    });

    let selection = receiver.await.map_err(|error| {
        WireError::new("dialog_failed", format!("the dialog was dropped: {error}"))
    })?;

    match selection {
        Some(path) => Ok(json!({
            "canceled": false,
            "filePath": path.to_string_lossy(),
        })),
        None => Ok(json!({ "canceled": true, "filePath": null })),
    }
}

pub async fn message(app: &AppHandle, params: &Value) -> Result<Value, WireError> {
    let (sender, receiver) = tokio::sync::oneshot::channel();

    let text = params
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let kind = match params.get("type").and_then(Value::as_str) {
        Some("error") => MessageDialogKind::Error,
        Some("warning") => MessageDialogKind::Warning,
        _ => MessageDialogKind::Info,
    };

    app.dialog()
        .message(text)
        .title(title(params))
        .kind(kind)
        .buttons(MessageDialogButtons::OkCancel)
        .show(move |confirmed| {
            let _ = sender.send(confirmed);
        });

    let confirmed = receiver.await.unwrap_or(false);

    // Electron returns the index of the clicked button; 0 is the default one.
    Ok(json!({ "response": if confirmed { 0 } else { 1 }, "checkboxChecked": false }))
}

pub fn error_box(app: &AppHandle, params: &Value) -> Result<Value, WireError> {
    let title = title(params);
    let content = params
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    app.dialog()
        .message(content)
        .title(title)
        .kind(MessageDialogKind::Error)
        .buttons(MessageDialogButtons::Ok)
        .show(|_| {});

    Ok(Value::Null)
}
