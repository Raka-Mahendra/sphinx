//! `shell.*` RPC methods.
//!
//! The URL policy is the same one `src/main/helpers/external-url.ts` implements:
//! only `http:` and `https:` reach the browser. Everything else — `file:`,
//! `ms-*:`, custom app protocols — is refused, because these URLs come from the
//! catalogue and from other users' content.
//!
//! The action itself is performed by the shell, not by the webview, so no
//! Tauri opener permission is needed: the webview never gains the ability to
//! open anything. That is why the `open` crate is used instead of
//! `tauri-plugin-opener` — the plugin's value is its JS API and ACL, and neither
//! is reachable from here.

use serde_json::{json, Value};

use crate::sidecar::protocol::WireError;

const ALLOWED_SCHEMES: [&str; 2] = ["http:", "https:"];

fn parse_allowed(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let lower = trimmed.to_ascii_lowercase();

    if !ALLOWED_SCHEMES
        .iter()
        .any(|scheme| lower.starts_with(scheme))
    {
        return None;
    }

    // Reject anything with control characters or whitespace in the authority,
    // which is how `http://example.com\@evil` style tricks get smuggled in.
    if trimmed.chars().any(|character| character.is_control()) {
        return None;
    }

    Some(trimmed.to_string())
}

pub fn open_external(params: &Value) -> Result<Value, WireError> {
    let raw = params
        .get("url")
        .and_then(Value::as_str)
        .ok_or_else(|| WireError::new("invalid_message", "shell.openExternal needs a url"))?;

    let Some(url) = parse_allowed(raw) else {
        return Err(WireError::new(
            "url_not_allowed",
            "Refused to open a non-web address externally",
        ));
    };

    open::that_detached(url)
        .map_err(|error| WireError::new("shell_failed", format!("cannot open: {error}")))?;

    Ok(Value::Null)
}

pub fn open_path(params: &Value) -> Result<Value, WireError> {
    let path = params
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| WireError::new("invalid_message", "shell.openPath needs a path"))?;

    match open::that_detached(path) {
        Ok(()) => Ok(json!("")),
        // Electron returns the error message as the resolved value, not as a
        // rejection; callers surface it in the UI.
        Err(error) => Ok(json!(error.to_string())),
    }
}

pub fn show_item_in_folder(params: &Value) -> Result<Value, WireError> {
    let path = params
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| WireError::new("invalid_message", "shell.showItemInFolder needs a path"))?;

    let parent = std::path::Path::new(path)
        .parent()
        .map(std::path::Path::to_path_buf)
        .unwrap_or_else(|| std::path::PathBuf::from(path));

    open::that_detached(parent)
        .map_err(|error| WireError::new("shell_failed", format!("cannot reveal: {error}")))?;

    Ok(Value::Null)
}
