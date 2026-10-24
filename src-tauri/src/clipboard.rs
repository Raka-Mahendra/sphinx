//! `clipboard.*` RPC methods.
//!
//! The baseline only writes (`src/main/events/misc/clipboard-write-text.ts`), so
//! reading is deliberately absent: a read primitive would let the renderer pull
//! whatever the user last copied.

use serde_json::Value;

use crate::sidecar::protocol::WireError;

pub fn write_text(params: &Value) -> Result<Value, WireError> {
    let text = params
        .get("text")
        .and_then(Value::as_str)
        .ok_or_else(|| WireError::new("invalid_message", "clipboard.writeText needs text"))?;

    let mut clipboard = arboard::Clipboard::new()
        .map_err(|error| WireError::new("clipboard_failed", error.to_string()))?;

    clipboard
        .set_text(text.to_string())
        .map_err(|error| WireError::new("clipboard_failed", error.to_string()))?;

    Ok(Value::Null)
}
