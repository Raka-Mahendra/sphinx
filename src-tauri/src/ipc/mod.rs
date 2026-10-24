//! The IPC surface exposed to the webview.
//!
//! Exactly two commands forward renderer traffic (`ipc_invoke`, `ipc_send`) plus
//! two supervisor controls. There is no generic "call anything" command: the
//! allowlist in `allowlist.rs` is generated from `src/main`, so a channel exists
//! here only if the baseline registers it.
//!
//! Channel validation happens **before** the sidecar sees the message, and the
//! sidecar validates again. A shell bug therefore cannot reach a handler that
//! was never audited.

pub mod allowlist;
pub mod commands;

pub use commands::{ipc_invoke, ipc_send, sidecar_restart, sidecar_status};


use std::sync::Arc;

use crate::sidecar::Supervisor;

/// Characters allowed after a dynamic event prefix. Must match
/// `DYNAMIC_CHARSET` in `src/sidecar/allowlist.ts`.
fn is_dynamic_char(character: char) -> bool {
    character.is_ascii_alphanumeric() || matches!(character, '_' | '.' | ':' | '@' | '-')
}

const DYNAMIC_MAX_LENGTH: usize = 200;

pub fn is_invoke_channel_allowed(channel: &str) -> bool {
    allowlist::INVOKE_CHANNELS.contains(&channel)
}

pub fn is_send_channel_allowed(channel: &str) -> bool {
    allowlist::SEND_CHANNELS.contains(&channel)
}

pub fn is_event_channel_allowed(channel: &str) -> bool {
    if allowlist::EVENT_CHANNELS.contains(&channel) {
        return true;
    }

    for prefix in allowlist::DYNAMIC_EVENT_PREFIXES {
        if let Some(remainder) = channel.strip_prefix(prefix) {
            if remainder.is_empty() || remainder.len() > DYNAMIC_MAX_LENGTH {
                continue;
            }

            if remainder.chars().all(is_dynamic_char) {
                return true;
            }
        }
    }

    false
}

/// State shared by the IPC commands.
pub struct AppState {
    pub supervisor: Arc<Supervisor>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn static_event_channels_are_allowed() {
        assert!(is_event_channel_allowed("on-download-progress"));
    }

    #[test]
    fn unknown_channels_are_refused() {
        assert!(!is_event_channel_allowed("on-not-a-real-channel"));
        assert!(!is_invoke_channel_allowed("not-a-real-channel"));
    }

    #[test]
    fn dynamic_event_prefixes_accept_ids_and_reject_paths() {
        assert!(is_event_channel_allowed(
            "on-update-achievements-12345-steam"
        ));
        assert!(is_event_channel_allowed(
            "on-ps1-memcard-scan-progress-0f8a1c2e-1111"
        ));

        // Path separators, whitespace and quotes must never pass.
        assert!(!is_event_channel_allowed(
            "on-update-achievements-../../etc/passwd"
        ));
        assert!(!is_event_channel_allowed(
            "on-update-achievements-12345 steam"
        ));
        assert!(!is_event_channel_allowed("on-update-achievements-"));
    }

    #[test]
    fn dynamic_event_prefix_needs_the_prefix() {
        assert!(!is_event_channel_allowed("update-achievements-12345-steam"));
    }
}
