//! Messages exchanged with the Node sidecar over JSON Lines on stdin/stdout.
//!
//! Mirrors `src/sidecar/protocol.ts` field for field. Both sides are generated
//! from the same intent but written by hand, so the shape is pinned by
//! `src-tauri/tests/protocol_contract.rs`, which round-trips the JSON literals
//! the TypeScript tests use.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Must match `PROTOCOL_VERSION` in `src/sidecar/protocol.ts`.
pub const PROTOCOL_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WireError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

impl WireError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
            stack: None,
            name: None,
        }
    }
}

/// Everything the sidecar may write to stdout.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum SidecarMessage {
    Ready {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        pid: u32,
        #[serde(rename = "bootMs")]
        boot_ms: u64,
    },
    Result {
        id: String,
        result: Value,
    },
    Error {
        id: String,
        error: WireError,
    },
    Event {
        channel: String,
        payload: Value,
    },
    Rpc {
        id: String,
        method: String,
        params: Value,
    },
    Heartbeat {
        seq: u64,
    },
    #[serde(rename = "shutdown-complete")]
    ShutdownComplete {
        reason: String,
        failures: Vec<String>,
    },
}

/// Everything the shell may write to the sidecar's stdin.
#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum HostMessage<'a> {
    Invoke {
        id: &'a str,
        channel: &'a str,
        args: &'a [Value],
        #[serde(rename = "windowLabel")]
        window_label: Option<&'a str>,
    },
    Send {
        id: &'a str,
        channel: &'a str,
        args: &'a [Value],
        #[serde(rename = "windowLabel")]
        window_label: Option<&'a str>,
    },
    #[serde(rename = "rpc-result")]
    RpcResult {
        id: &'a str,
        result: Value,
    },
    #[serde(rename = "rpc-error")]
    RpcError {
        id: &'a str,
        error: WireError,
    },
    Control {
        action: &'a str,
        #[serde(skip_serializing_if = "Option::is_none")]
        seq: Option<u64>,
        #[serde(rename = "timeoutMs", skip_serializing_if = "Option::is_none")]
        timeout_ms: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        label: Option<&'a str>,
        #[serde(rename = "windowId", skip_serializing_if = "Option::is_none")]
        window_id: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        url: Option<&'a str>,
        #[serde(rename = "forceBigPicture", skip_serializing_if = "Option::is_none")]
        force_big_picture: Option<bool>,
    },
}

impl<'a> HostMessage<'a> {
    pub fn ping(seq: u64) -> Self {
        HostMessage::Control {
            action: "ping",
            seq: Some(seq),
            timeout_ms: None,
            label: None,
            window_id: None,
            url: None,
            force_big_picture: None,
        }
    }

    pub fn shutdown(timeout_ms: u64) -> Self {
        HostMessage::Control {
            action: "shutdown",
            seq: None,
            timeout_ms: Some(timeout_ms),
            label: None,
            window_id: None,
            url: None,
            force_big_picture: None,
        }
    }

    /// A `sphinx://` URL arrived: first launch, second instance, or the OS.
    ///
    /// Forwarded verbatim so `src/main/deep-link.ts` decides what it means. The
    /// shell never interprets the URL itself, exactly like the baseline, where
    /// `app.on("second-instance")` handed the raw argv to `handleDeepLinkPath`.
    pub fn deep_link(url: &'a str) -> Self {
        HostMessage::Control {
            action: "deep-link",
            seq: None,
            timeout_ms: None,
            label: None,
            window_id: None,
            url: Some(url),
            force_big_picture: None,
        }
    }

    /// A second instance started. `url` carries a deep link when argv had one.
    pub fn second_instance(url: Option<&'a str>, force_big_picture: bool) -> Self {
        HostMessage::Control {
            action: "second-instance",
            seq: None,
            timeout_ms: None,
            label: None,
            window_id: None,
            url,
            force_big_picture: Some(force_big_picture),
        }
    }

    /// A tray menu item was clicked. `label` carries the item id.
    pub fn tray_click(item_id: &'a str) -> Self {
        HostMessage::Control {
            action: "tray-click",
            seq: None,
            timeout_ms: None,
            label: Some(item_id),
            window_id: None,
            url: None,
            force_big_picture: None,
        }
    }

    /// A tray icon mouse event: `click`, `double-click`, `right-click`.
    pub fn tray_event(kind: &'a str) -> Self {
        HostMessage::Control {
            action: "tray-event",
            seq: None,
            timeout_ms: None,
            label: Some(kind),
            window_id: None,
            url: None,
            force_big_picture: None,
        }
    }

    /// Download progress for an update, in bytes.
    ///
    /// `window_id` is unused here; `seq` carries the bytes received and
    /// `timeout_ms` the total size when the server sent one.
    pub fn update_progress(downloaded: u64, total: Option<u64>) -> Self {
        HostMessage::Control {
            action: "update-progress",
            seq: Some(downloaded),
            timeout_ms: total,
            label: None,
            window_id: None,
            url: None,
            force_big_picture: None,
        }
    }

    /// The shell finished loading a window's first page.
    ///
    /// The sidecar turns this into Electron's `ready-to-show`. Without it a
    /// window the sidecar created (`new BrowserWindow(...)` with `show: false`)
    /// stays hidden forever, because the sidecar owns the `show()` call and
    /// never learns that painting finished.
    pub fn window_ready(label: &'a str) -> Self {
        HostMessage::Control {
            action: "window-ready",
            seq: None,
            timeout_ms: None,
            label: Some(label),
            window_id: None,
            url: None,
            force_big_picture: None,
        }
    }

    pub fn window_attached(label: &'a str, window_id: u32, url: &'a str) -> Self {
        HostMessage::Control {
            action: "window-attached",
            seq: None,
            timeout_ms: None,
            label: Some(label),
            window_id: Some(window_id),
            url: Some(url),
            force_big_picture: None,
        }
    }

    pub fn window_detached(label: &'a str) -> Self {
        HostMessage::Control {
            action: "window-detached",
            seq: None,
            timeout_ms: None,
            label: Some(label),
            window_id: None,
            url: None,
            force_big_picture: None,
        }
    }
}

/// RPC methods the sidecar may call. Kept in sync with `HOST_RPC_METHODS` in
/// `src/sidecar/protocol.ts`; anything else is rejected before dispatch.
pub const HOST_RPC_METHODS: &[&str] = &[
    "app.quit",
    "app.version",
    "clipboard.writeText",
    "dialog.showOpenDialog",
    "dialog.showSaveDialog",
    "dialog.showMessageBox",
    "dialog.showErrorBox",
    "keychain.delete",
    "keychain.get",
    "keychain.set",
    "path.get",
    "path.resources",
    "notification.show",
    "power.setSleepBlocked",
    "autolaunch.get",
    "autolaunch.set",
    "shell.openExternal",
    "shell.openPath",
    "shell.showItemInFolder",
    "tray.create",
    "tray.remove",
    "tray.setIcon",
    "tray.setMenu",
    "tray.setTooltip",
    "updater.check",
    "updater.download",
    "updater.install",
    "updater.state",
    "window.call",
    "window.create",
];

pub fn is_host_rpc_method(method: &str) -> bool {
    HOST_RPC_METHODS.contains(&method)
}
