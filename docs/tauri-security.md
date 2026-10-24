# Tauri v2 security — what is actually proven, and how

Every claim below is backed by the Tauri v2 documentation and by the code in this
repository. Nothing here is assumed.

## 1. Custom commands are only callable by permitted windows

**Documentation**, `https://v2.tauri.app/security/capabilities/`:

> "By default, all commands that you registered in your app (using the
> `tauri::Builder::invoke_handler` function) are allowed to be used by all the
> windows and webviews of the app. To change that, consider using
> `AppManifest::commands`."

That default is exactly what a launcher with 311 IPC channels does not want, so
it is switched off. `src-tauri/build.rs` lists the four commands the shell
exposes:

```rust
AppManifest::new().commands(&[
    "ipc_invoke",
    "ipc_send",
    "sidecar_restart",
    "sidecar_status",
])
```

With that manifest in place, a window may call a command only if a capability
grants it. `src-tauri/capabilities/default.json` grants them to exactly two
window labels:

```json
"windows": ["main", "big-picture"],
"permissions": [
  "core:default",
  "core:event:default",
  "allow-ipc-invoke",
  "allow-ipc-send",
  "allow-sidecar-restart",
  "allow-sidecar-status"
]
```

The permission identifiers are `allow-<kebab-case-command>`; Tauri's own error
message names them, and a misspelling fails the build rather than silently
granting access to nothing.

The same page adds a note that matters for a later phase: "The security
boundaries are depending on window labels (**not titles**). We recommend to only
expose of the window creation functionality to higher privileged windows."
Fase 5 must not add a capability for the theme editor, the game launcher, or any
window that loads remote content without reviewing that sentence first.

**Code**: `src-tauri/src/lib.rs` registers only these four commands via
`invoke_handler`. There is no `#[tauri::command]` anywhere else in the crate.

### Observed at runtime

The gating is not theoretical: the first `yarn tauri dev` run with the manifest
in place showed the Big Picture window rendering a blank page, because it was
created without a label and Tauri rejected every `ipc_invoke` from
`sphinx-window-1`. Giving the window `label: "big-picture"` fixed it. A window
that is not listed in a capability cannot call anything — that is the behaviour
the PRD asked to be proven, and it was observed by accident before it was
observed on purpose.

## 2. Remote and iframe content cannot `invoke`

**Documentation**, `https://v2.tauri.app/security/capabilities/`, "Remote API
Access":

> "By default the API is only accessible to bundled code shipped with the Tauri
> App. To allow remote sources access to certain Tauri Commands it is possible
> to define this in the capability configuration file."

Sphinx has **no** capability with a `remote` block. There is no `remote.urls`
entry in `src-tauri/capabilities/default.json` and no `app.security.remote`
section in `src-tauri/tauri.conf.json`. So the only code that can reach
`ipc_invoke` is the bundled renderer in `out/renderer` and the bundled Big
Picture in `out/big-picture`.

This is the reason the CSP in `tauri.conf.json` keeps `frame-src 'self'`: an
`<iframe>` pointing at a remote site is refused by the webview, so no remote
document ever exists in a window that holds the command capability.

The same documentation section carries the caveat that has to be re-checked on
Linux: "On Linux and Android, Tauri is unable to distinguish between requests
from an embedded `<iframe>` and the window itself." Linux is Fase 9, and the
`frame-src 'self'` CSP plus the absence of a `remote` capability are the two
things that keep that caveat from mattering here. Fase 9 must re-verify both
before shipping a Linux build.

**Related**, `https://v2.tauri.app/security/`:

> "Any code executed in the WebView has only access to exposed system resources
> via the well-defined IPC layer."

The sidecar never appears in the webview. It is a separate OS process that Rust
spawns; no renderer code can reach it except through `ipc_invoke`.

## 3. The baseline's remote-renderer branch is gone

`docs/electron-api-usage.md` §6 records the baseline behaviour: if
`MAIN_VITE_LAUNCHER_SUBDOMAIN` is set, the main window loads
`https://release-v<version>.<subdomain>#/<hash>` and falls back to the local
bundle only if that fails. Remote code execution by configuration.

`src/main/services/window-manager.ts` no longer contains that branch.
`loadWindowURL` now loads the bundled `index.html`, or `SPHINX_RENDERER_URL` in
development — which the shell sets to `http://localhost:5173` and which only the
developer controls.

## 4. CSP

`tauri.conf.json` keeps a strict CSP:

```
default-src 'self' ipc: http://ipc.localhost;
script-src 'self' 'unsafe-inline' 'unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob: https: http: asset: http://asset.localhost;
media-src 'self' data: blob: https: http: asset: http://asset.localhost;
font-src 'self' data:;
connect-src 'self' ipc: http://ipc.localhost https: http: ws: wss:;
worker-src 'self' blob:;
frame-src 'self'
```

`'unsafe-inline'` and `'unsafe-eval'` in `script-src` are the price of the
renderer's existing build: React's runtime injection and Monaco's worker setup
both need them, and Fase 5's UI audit is the place to remove them. `frame-src
'self'` is the entry that keeps remote documents out of a window that can
`invoke`, and it must not be relaxed.

## 5. The loss of the isolated world

Electron's preload ran in a separate context with `contextIsolation: true`. In
Tauri the bridge runs in the same JS world as the renderer, so any renderer code
— including third-party code pulled in by a dependency — can read
`window.electron` and call its methods directly. PRD §4.A.2 accepts this trade.

What compensates for it, concretely:

1. **Command gating** (§1): only two window labels hold the capability.
2. **The allowlist** (`src-tauri/src/ipc/allowlist.rs`, generated from
   `src/main` by `scripts/generate-ipc-allowlist.mjs`): 346 invoke channels,
   71 event channels, 6 dynamic prefixes. Anything else is rejected by Rust with
   `channel_not_allowed` before the sidecar sees it, and by the sidecar again.
3. **No shell capability in the webview**: dialogs, the browser, the clipboard,
   the keychain and the updater are Rust-only, reachable from the sidecar
   through `HOST_RPC_METHODS` — a list that is validated on both sides.
4. **`hydraApiCall` is gone.** The baseline's arbitrary authenticated API
   primitive is not carried over; it disappears with the account features.

## 6. What is not proven here

- The iframe/remote distinction on **Linux and Android** — documented Tauri
  limitation, not tested. Fase 9.
- `sharp`, `hydra-native` and `classic-level` were verified to load under Node
  22; whether the torrent engine can reach the internet through the corporate
  proxy is not a security claim and is not asserted anywhere in this document.
