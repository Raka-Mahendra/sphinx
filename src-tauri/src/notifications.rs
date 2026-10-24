//! Native notifications.
//!
//! The baseline calls `new Notification({ title, body, icon }).show()` from
//! `src/main/services/notifications/index.ts` and
//! `src/main/events/notifications/publish-new-repacks-notification.ts`. The
//! sidecar keeps doing that; this module is the native half.
//!
//! Sources:
//! - plugin: <https://v2.tauri.app/plugin/notification/>
//! - builder: <https://docs.rs/tauri-plugin-notification/latest/tauri_plugin_notification/struct.NotificationBuilder.html>

use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

use crate::sidecar::protocol::WireError;

/// `new Notification({ title, body, icon }).show()`.
///
/// `icon` is a file path in the baseline (`downloadImage()` writes a cached file
/// and returns its path), so it is read here rather than passed as bytes.
pub async fn show(app: &AppHandle, params: &Value) -> Result<Value, WireError> {
    let title = params
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let body = params
        .get("body")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let mut builder = app.notification().builder().title(title).body(body);

    if let Some(path) = params.get("icon").and_then(Value::as_str) {
        // `NotificationBuilder::icon` takes the file path, not decoded pixels
        // (tauri-plugin-notification 2.7). A missing file makes the plugin skip
        // the icon, which is what Electron did too.
        builder = builder.icon(path);
    }

    builder
        .show()
        .map_err(|error| WireError::new("notification_failed", error.to_string()))?;

    Ok(Value::Null)
}
