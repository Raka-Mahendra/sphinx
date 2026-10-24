//! `keychain.*` RPC methods.
//!
//! Google Drive refresh tokens (PRD §4.F.2) must not sit in LevelDB in clear
//! text, and the sidecar cannot reach the OS credential store itself. The shell
//! owns it: Windows Credential Manager, macOS Keychain, Secret Service on Linux,
//! through the `keyring` crate.
//!
//! The service name is fixed so the sidecar cannot write into another app's
//! credentials by passing a different one.

use serde_json::{json, Value};

use crate::sidecar::protocol::WireError;

const SERVICE: &str = "Sphinx Launcher";

fn entry(params: &Value) -> Result<keyring::Entry, WireError> {
    let account = params
        .get("account")
        .and_then(Value::as_str)
        .ok_or_else(|| WireError::new("invalid_message", "keychain needs an account"))?;

    keyring::Entry::new(SERVICE, account)
        .map_err(|error| WireError::new("keychain_failed", error.to_string()))
}

pub fn handle(method: &str, params: &Value) -> Result<Value, WireError> {
    match method {
        "keychain.set" => {
            let password = params
                .get("secret")
                .and_then(Value::as_str)
                .ok_or_else(|| WireError::new("invalid_message", "keychain.set needs a secret"))?;

            entry(params)?
                .set_password(password)
                .map_err(|error| WireError::new("keychain_failed", error.to_string()))?;

            Ok(Value::Null)
        }

        "keychain.get" => {
            let result = entry(params)?.get_password();

            match result {
                Ok(secret) => Ok(json!(secret)),
                // Electron's `safeStorage` returns null for a missing entry; the
                // sidecar distinguishes "not stored yet" from a real failure by
                // the null, so a missing entry is not an error.
                Err(keyring::Error::NoEntry) => Ok(Value::Null),
                Err(error) => Err(WireError::new("keychain_failed", error.to_string())),
            }
        }

        "keychain.delete" => {
            match entry(params)?.delete_credential() {
                Ok(()) => Ok(Value::Null),
                Err(keyring::Error::NoEntry) => Ok(Value::Null),
                Err(error) => Err(WireError::new("keychain_failed", error.to_string())),
            }
        }

        other => Err(WireError::new(
            "rpc_method_not_allowed",
            format!("rpc_method_not_allowed: {other}"),
        )),
    }
}
