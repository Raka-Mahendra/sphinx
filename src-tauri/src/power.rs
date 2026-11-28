//! `power.*` RPC methods.
//!
//! Keeps the display awake while a download runs or a compatibility layer
//! launches (`src/main/services/power-save-blocker.ts`). The sidecar sends
//! `power.setSleepBlocked { blocked: true }` / `{ blocked: false }` via RPC;
//! the shell holds a `keepawake::KeepAwake` guard while blocked.

use std::sync::Mutex;

use serde_json::Value;

use crate::sidecar::protocol::WireError;

static GUARD: Mutex<Option<keepawake::KeepAwake>> = Mutex::new(None);

pub fn set_sleep_blocked(params: &Value) -> Result<Value, WireError> {
    let blocked = params
        .get("blocked")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let mut guard = GUARD
        .lock()
        .map_err(|e| WireError::new("power_lock_poisoned", e.to_string()))?;

    if blocked {
        if guard.is_none() {
            match keepawake::Builder::default()
                .display(true)
                .idle(true)
                .reason("Sphinx Launcher download or game session")
                .app_name("Sphinx Launcher")
                .app_reverse_domain("io.github.rakamahendra.sphinx")
                .create()
            {
                Ok(ka) => {
                    *guard = Some(ka);
                }
                Err(e) => {
                    eprintln!("[power] failed to inhibit sleep: {e}");
                    return Ok(serde_json::json!({
                        "blocked": false,
                        "supported": false,
                        "error": e.to_string(),
                    }));
                }
            }
        }
    } else {
        // Dropping the guard restores the previous power state.
        *guard = None;
    }

    Ok(serde_json::json!({ "blocked": blocked, "supported": true }))
}
