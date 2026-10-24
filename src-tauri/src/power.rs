//! `power.*` RPC methods.
//!
//! The baseline keeps the display awake while a download runs or a compatibility
//! layer launches (`src/main/services/power-save-blocker.ts`). Tauri v2 has no
//! cross-platform equivalent, and the Windows call (`SetThreadExecutionState`)
//! needs a `windows-sys` dependency whose feature set would have to be kept in
//! step with Tauri's own.
//!
//! This is a **documented gap**, not a silent no-op: the sidecar logs once that
//! sleep blocking is unavailable, and `docs/sidecar.md` records it. Downloads
//! still work; the display may simply sleep mid-download, which the baseline
//! prevented.

use std::sync::Once;

use serde_json::Value;

use crate::sidecar::protocol::WireError;

static WARN_ONCE: Once = Once::new();

pub fn set_sleep_blocked(params: &Value) -> Result<Value, WireError> {
    let blocked = params
        .get("blocked")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    WARN_ONCE.call_once(|| {
        eprintln!(
            "[power] sleep blocking is not implemented in the Tauri shell; the display may sleep during downloads (see docs/sidecar.md)"
        );
    });

    Ok(serde_json::json!({ "blocked": blocked, "supported": false }))
}
