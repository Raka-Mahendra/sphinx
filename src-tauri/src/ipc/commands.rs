use serde_json::Value;
use tauri::{State, WebviewWindow};

use super::{
    is_invoke_channel_allowed, is_send_channel_allowed, AppState,
};
use crate::sidecar::protocol::WireError;

/// Renderer → sidecar, expecting a result.
///
/// Mirrors `ipcRenderer.invoke`. The window label travels with the request so the
/// sidecar can build an `IpcMainInvokeEvent` whose `sender` resolves back to the
/// window that called.
#[tauri::command]
pub async fn ipc_invoke(
    window: WebviewWindow,
    state: State<'_, AppState>,
    channel: String,
    args: Vec<Value>,
) -> Result<Value, WireError> {
    if !is_invoke_channel_allowed(&channel) {
        return Err(WireError::new(
            "channel_not_allowed",
            format!("channel_not_allowed: {channel}"),
        ));
    }

    let supervisor = state.supervisor.clone();
    let label = window.label().to_string();

    supervisor
        .invoke(&channel, &args, Some(label.as_str()))
        .await
}

/// Renderer → sidecar, fire and forget.
#[tauri::command]
pub async fn ipc_send(
    window: WebviewWindow,
    state: State<'_, AppState>,
    channel: String,
    args: Vec<Value>,
) -> Result<(), WireError> {
    if !is_send_channel_allowed(&channel) {
        return Err(WireError::new(
            "channel_not_allowed",
            format!("channel_not_allowed: {channel}"),
        ));
    }

    let supervisor = state.supervisor.clone();
    let label = window.label().to_string();

    supervisor.send(&channel, &args, Some(label.as_str())).await
}

/// Used by the "Try again" dialog after the supervisor gave up.
#[tauri::command]
pub async fn sidecar_restart(state: State<'_, AppState>) -> Result<(), WireError> {
    let supervisor = state.supervisor.clone();
    supervisor.restart().await
}

#[tauri::command]
pub async fn sidecar_status(state: State<'_, AppState>) -> Result<Value, WireError> {
    let supervisor = state.supervisor.clone();
    Ok(supervisor.status().await)
}
