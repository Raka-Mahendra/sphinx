//! The `local:` scheme, which is how library artwork is addressed.
//!
//! The baseline registers it as privileged and serves files from disk:
//!
//! ```text
//! protocol.registerSchemesAsPrivileged([{ scheme: "local",
//!   privileges: { supportFetchAPI: true, corsEnabled: true, stream: true } }]);
//! protocol.handle("local", (request) =>
//!   net.fetch(pathToFileURL(decodeURI(request.url.slice("local:".length)))));
//! ```
//! (`src/main/index.ts:64-95`). Producers store URLs as `local:<absolute path>`
//! (`src/main/services/game-artwork.ts:150`, `get-cover-poster.ts:156`), and
//! `<img src>` renders them directly.
//!
//! Tauri cannot serve a custom scheme under its own name: on Windows a
//! registered scheme is exposed to the webview as
//! `http://<scheme>.localhost/<path>`, on Linux/macOS as
//! `<scheme>://localhost/<path>`. So the *data* keeps the `local:` form and the
//! webview bridge rewrites it at the DOM boundary with `convertFileSrc`
//! (`src/tauri-bridge/asset-url.ts`). This module is the server half.
//!
//! Source: <https://v2.tauri.app/reference/javascript/api/namespacecore/#convertfilesrc>

use std::borrow::Cow;
use std::path::PathBuf;

use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime, UriSchemeContext};

/// Serves `local:` requests from disk.
///
/// The path arrives percent-encoded because `convertFileSrc` encodes it, and it
/// may still carry the leading slash Tauri adds. Both are undone here; anything
/// that does not resolve to a readable file answers 404 instead of guessing.
pub fn handle_local<R: Runtime>(
    _context: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
) -> Response<Cow<'static, [u8]>> {
    let raw = request.uri().path();

    let decoded = match percent_decode(raw) {
        Some(decoded) => decoded,
        None => return not_found("malformed path"),
    };

    // `http://local.localhost/C%3A/path` -> `C:/path`; on Linux the path starts
    // with `/` and must keep it.
    let path = PathBuf::from(decoded);

    match std::fs::read(&path) {
        Ok(bytes) => Response::builder()
            .status(StatusCode::OK)
            .header("content-type", content_type(&path))
            .header("access-control-allow-origin", "*")
            .body(Cow::Owned(bytes))
            .unwrap_or_else(|_| not_found("cannot build the response")),
        Err(error) => {
            eprintln!("[local] cannot read {}: {error}", path.display());
            not_found("file not readable")
        }
    }
}

fn not_found(reason: &str) -> Response<Cow<'static, [u8]>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .header("content-type", "text/plain")
        .body(Cow::Owned(reason.as_bytes().to_vec()))
        .expect("static response")
}

/// Minimal percent-decoder.
///
/// Only `%XX` is decoded; anything else is copied through, which is what
/// `decodeURI` did for the baseline's paths.
fn percent_decode(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = bytes.get(index + 1..index + 3)?;
            let value = u8::from_str_radix(std::str::from_utf8(hex).ok()?, 16).ok()?;
            out.push(value);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }

    String::from_utf8(out).ok()
}

/// Content type by extension, limited to what artwork actually is.
fn content_type(path: &std::path::Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("ico") => "image/x-icon",
        Some("avif") => "image/avif",
        _ => "application/octet-stream",
    }
}

/// Resolves the resource directory once, for callers that need a file path.
pub fn resource_path<R: Runtime>(app: &AppHandle<R>, name: &str) -> Option<PathBuf> {
    app.path().resource_dir().ok().map(|dir| dir.join(name))
}
