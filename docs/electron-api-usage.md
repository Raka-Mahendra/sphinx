# Electron API usage — Hydra 4.1.6 baseline

Baseline commit: `be492f5e3fc4a37c55d7df2b07faf5f9565c84dd`.
Audit method: source inspection of `src/main`, `src/preload`, `src/renderer`,
`src/big-picture`, `electron.vite.config.ts`, and `electron-builder.yml`.

This document is an inventory and a migration risk list, not a promise that
Tauri has a drop-in equivalent. The target architecture keeps `src/main` in a
Node sidecar (PRD A1), so most Node/Electron-adjacent modules stay in
JavaScript. Only the shell-facing APIs below need a Tauri command or plugin.

## 1. Runtime shape

- Electron main entry: `src/main/index.ts`; application wiring: `src/main/main.ts`.
- Renderer entry: `src/renderer/src/main.tsx`.
- Preload bridge: `src/preload/index.ts`, exposed as `window.electron`
  (`contextBridge.exposeInMainWorld("electron", ...)` at line 165).
- Big Picture is a second renderer/bundle (`src/big-picture`), launched in its
  own `BrowserWindow`.
- There are nine window classes: main, Big Picture, friends, chat, auth,
  RetroAchievements connection, theme editor, game launcher, and the
  achievement-notification overlay. All are `BrowserWindow` instances; the
  Linux auth flow also uses a child `WebContentsView`.

## 2. API inventory

Counts are approximate source occurrences, used only to show where the API is
concentrated. The file:line evidence is authoritative.

| Electron API | Occurrences | Main evidence | Tauri v2 replacement / decision |
| --- | ---: | --- | --- |
| `app` | 219 | `src/main/index.ts:51,65,86,99,362,388,395,402`; `src/main/services/window-manager.ts:15` | Tauri `AppHandle`, `app.path()`, `RunEvent`; plugins for single-instance and deep-link. Sidecar receives resolved paths from Rust. |
| `BrowserWindow` | 65 | `window-manager.ts:311,502,566,670,914,953,1037,1123,1201`; `achievement-notification-presenter-electron.ts:84` | `WebviewWindowBuilder`; child webviews for the auth view. Window state, custom frame, transparency and always-on-top are supported but need per-window verification. |
| `WebContentsView` | 1 | `window-manager.ts:977` (Linux auth) | Child webview (`WebviewBuilder`) or a dedicated auth window. Do not embed remote content in the trusted main webview. |
| `ipcMain` | 59 | `src/main/events/index.ts`; `register-event.ts:1-7`; `main-window-controls.ts` | `#[tauri::command]` plus a single `ipc_invoke` RPC entry; allowlist generated from source (PRD A12). |
| `ipcRenderer` | 513 | `src/preload/index.ts` | Tauri `invoke`/`listen` shim. The preload is reused with a shim, never exposed to remote content. |
| `contextBridge` | 1 | `src/preload/index.ts:165` | No equivalent needed if the shim runs in the same JS world; PRD A2/§4.A.2 explicitly accepts the loss of the isolated world and relies on the Rust allowlist. |
| `protocol.handle` | 2 schemes | `src/main/index.ts:113` (`local:`), `src/main/index.ts:118` (`gradient:`) | Tauri `register_uri_scheme_protocol` / asset protocol. The `local:` handler must be scoped to approved directories. |
| `net.fetch` | 1 | `src/main/index.ts:115` | Rust `reqwest` or `tauri-plugin-http`; sidecar can keep Node `fetch`. |
| `shell.openExternal` / `openPath` | several | `events/misc/open-external.ts:21`; `window-manager.ts:470`; `helpers/launch-game.ts:984`; tray `shell.openPath` at `window-manager.ts` | `tauri-plugin-opener`; enforce an `http(s)` allowlist at the command boundary. |
| `dialog.showOpenDialog` | 4+ | `events/misc/show-open-dialog.ts:12,16`; cloud-save path selectors at `select-cloud-save-custom-path.ts:53` and peers | `tauri-plugin-dialog`; return the same `{ canceled, filePaths }` shape. |
| `Menu`, `MenuItem`, `Tray` | tray + context menu | `window-manager.ts:1312-1325`, recent-games menu below | `tauri::tray::TrayIconBuilder` + `tauri::menu::MenuBuilder`; Windows theme icon switching (`nativeTheme`) needs a Tauri theme listener. |
| `nativeImage` | tray/icon/screenshot | `window-manager.ts:1308`; `linux-game-capture-session.ts:1` | `tauri::image::Image`; image decoding for screenshots stays in the sidecar or a Rust image crate. |
| `nativeTheme` | 2 | `window-manager.ts:1310` (tray icon) | Tauri `theme()`/`on_theme_changed`; verify Windows taskbar theme behavior. |
| `screen` | window placement | `window-manager.ts:1190`; `achievement-notification-presenter-electron.ts:16` | `app.available_monitors()` / `current_monitor()`; account for DPI and multi-monitor coordinates. |
| `powerMonitor` | 2 | `src/main/index.ts:194-195` (Epic suspend/resume) | No core Tauri v2 equivalent; use OS power events or a plugin. This is only used by Epic in the baseline and disappears with Epic. |
| `powerSaveBlocker` | 1 | `src/main/services/power-save-blocker.ts` | Rust command using `SetThreadExecutionState` on Windows (or a plugin); preserve download/compatibility-launch semantics. |
| `crashReporter` | 1 | `src/main/index.ts:51` (`uploadToServer: false`) | No Electron crash reporter. Rust panic log + sidecar uncaught-exception log (PRD §9). |
| `desktopCapturer` | screenshots | `src/main/services/screenshot.ts:1`; `linux-game-capture-session.ts:1` | Core Tauri has no equivalent; use a platform capture crate/API (for example `xcap`) or keep capture in a native helper. Verify Wayland behavior separately. |
| `clipboard` | 1 | `events/misc/clipboard-write-text.ts` | `tauri-plugin-clipboard-manager`; currently write-only. |
| `safeStorage` | 0 | no matches | Not used in the baseline. Google Drive refresh tokens must use Rust `keyring` (PRD 4.F.2). |
| `globalShortcut` | 0 | no matches | Not used. |
| `Notification` | 0 | no matches | The app uses custom `BrowserWindow` overlays, not native notifications. Keep the overlay window in Tauri. |
| `session.webRequest` | 1 | `window-manager.ts:342,372` | No direct Tauri equivalent. Needed for CORS header rewriting and SteamGridDB cache headers; move to a sidecar proxy or accept the WebView2 CORS behavior after tests. |
| `auto-launch` (npm) | 1 | `src/main/events/user-preferences/auto-launch.ts` | `tauri-plugin-autostart`; preserve the `{ enabled, minimized }` shape. |
| `electron-updater` | 1 | `src/main/services/update-manager.ts`; feed at `src/main/index.ts:54` | `tauri-plugin-updater`; the sidecar keeps the `autoUpdaterEvent` payload shape (PRD 4.E). |
| `electron-log` | multiple | `src/main/services/logger.ts` | Keep file logging in the sidecar; Rust writes its own log. Do not add Sentry. |

## 3. Windows and their security settings

| Window | Construction | Important settings | Migration note |
| --- | --- | --- | --- |
| Main | `window-manager.ts:311` | frameless/custom title bar on Windows; `sandbox: false`; preload | Preserve custom chrome and min/max/close IPC. `sandbox: false` is a baseline weakness; do not copy it to Tauri. |
| Big Picture | `window-manager.ts:502` | frameless; `sandbox: false`; full-screen-style layout | Separate Tauri window; same bridge and feature flags. |
| Friends | `window-manager.ts:566` | frameless; `sandbox: false` | Feature-flagged off in v1. |
| Chat | `window-manager.ts:670` | frameless; `sandbox: false`; blocks new windows and navigation | Feature-flagged off in v1. |
| Auth (Windows/macOS) | `window-manager.ts:914` | frameless/modal; `sandbox: false`; loads remote auth URL | Removed with login. |
| Auth (Linux) | `window-manager.ts:953` + `WebContentsView` at 977 | `sandbox: false`; `nodeIntegrationInSubFrames: true`; remote URL | Highest-risk baseline window. Removed with login; never reproduce. |
| RetroAchievements connection | `window-manager.ts:1037` | frameless; preload | Feature-flagged off in v1. |
| Theme editor | `window-manager.ts:1123` | frameless; preload; opens main devtools in dev | Keep if themes remain; verify child-window lifecycle. |
| Game launcher | `window-manager.ts:1201` | frameless, fixed size; `sandbox: false`; preload | Keep; it is part of the launch flow. |
| Achievement notification | `achievement-notification-presenter-electron.ts:84` | transparent, focusable: false, always-on-top, `setIgnoreMouseEvents(true)`, `sandbox: false` | Feature-flagged off in v1. If retained later, use a Tauri overlay window with click-through. |

Every `BrowserWindow` above passes `sandbox: false`. `contextIsolation` is not
set explicitly, so it stays at Electron's default (`true`), and
`nodeIntegration` stays `false`; the preload is the only bridge. The Linux auth
`WebContentsView` is the exception: `nodeIntegrationInSubFrames: true` gives
Node capabilities to subframes of a remote page. This must not be carried into
Sphinx.

## 4. Application lifecycle and deep links

From `src/main/index.ts`:

- `app.requestSingleInstanceLock()` at line 65; quit immediately when the lock
  is not acquired.
- `second-instance` handler at line 362 restores/focuses the existing window.
- `open-url` handler at line 388 handles macOS deep links.
- `window-all-closed` at line 395; `before-quit` at line 402 performs shutdown
  (the sidecar shutdown/torrent flush must be added here in the Tauri design).
- `app.setAsDefaultProtocolClient("hydralauncher")` at lines 99/104. Tauri:
  protocol `sphinx://`, `tauri-plugin-deep-link` plus `tauri-plugin-single-instance`.
- `app.commandLine.appendSwitch("ozone-platform-hint", "auto")` on Linux at
  line 69. No Tauri equivalent; Linux is optional Fase 9.
- `crashReporter.start({ uploadToServer: false })` at line 51. No upload, but
  local crash dumps are written to `app.getPath("crashDumps")` and logged at
  line 108.

Deep-link routes are registered in `src/main/main.ts` / `src/main/index.ts`:
`run`, `install-source`, `profile`, `install-theme`, `steam-connected`, and
auth/update-account. PRD keeps only `sphinx://run`; the rest disappear with the
account-dependent features.

## 5. Custom protocols (high risk)

`protocol.registerSchemesAsPrivileged` at `src/main/index.ts:86` registers
`local:` and `gradient:` with `supportFetchAPI`, `corsEnabled`, and (for
`local:`) `stream`.

`local:` handler:

```ts
protocol.handle("local", (request) => {
  const filePath = request.url.slice("local:".length);
  return net.fetch(url.pathToFileURL(decodeURI(filePath)).toString());
});
```

There is no directory allowlist. Any renderer code that can construct a
`local:` URL can read a file the process can read. This is a baseline local
file-read primitive. In Tauri:

- use `register_uri_scheme_protocol` with a canonicalized path check against
  the app's asset/library/cache roots;
- reject `..`, UNC paths, device paths, symlinks that escape the root, and
  non-image/non-media extensions if the protocol is only for UI assets;
- never expose arbitrary `file://` through the Tauri asset protocol.

`gradient:` builds an SVG response from URL text (`index.ts:118-172`). It
interpolates `direction`, `color1`, and `color2` into SVG attributes without a
strict color/direction grammar. A renderer-controlled URL can inject extra SVG
markup. Keep the feature, but validate with an allowlist of directions and
`#rgb`/`#rrggbb` colors, and return a fixed SVG template.

## 6. Web requests, CORS and remote renderer

`window-manager.ts:342` installs `session.webRequest.onBeforeSendHeaders` for
the main and Big Picture windows:

- requests to `workwonders` get an `Origin: https://workwonders.app` header;
- all other artwork-renderer requests get a random `User-Agent`.

`window-manager.ts:372` installs `onHeadersReceived`:

- SteamGridDB artwork gets cache-control headers;
- for main/Big Picture requests, except `featurebase`, `chatwoot`, and
  `workwonders`, responses get `Access-Control-Allow-Origin: *`, permissive
  methods/headers, and a synthetic `OPTIONS` 200.

This makes the renderer treat cross-origin artwork as CORS-enabled. Tauri's
WebView2 does not expose a global response-header rewrite API. Options:

1. Move artwork fetching to the sidecar/Rust proxy and serve same-origin bytes.
2. Use Tauri's HTTP plugin with an explicit scope and no CORS rewrite.
3. Accept CORS failures after testing the actual artwork URLs; do not silently
   weaken WebView2 security.

`loadWindowURL` (`window-manager.ts:147`) has a production remote-renderer path:
if `MAIN_VITE_LAUNCHER_SUBDOMAIN` is set, it loads
`https://release-v<version>.<subdomain>#/<hash>` and falls back to the local
bundle only on failure. That is remote code execution by configuration. Sphinx
must always load its bundled renderer; do not carry this branch.

## 7. Navigation and window-open policy

- Main window: `setWindowOpenHandler` at `window-manager.ts:469` calls
  `shell.openExternal(handler.url)` **without** `parseExternalUrl`, then denies
  the new window. This is weaker than the `openExternal` IPC handler and can
  open non-http(s) schemes. Tauri's opener command must apply the same
  `http:`/`https:` allowlist to every caller.
- Chat window: `setWindowOpenHandler` denies and `will-navigate` blocks
  navigation (`window-manager.ts:693-698`).
- `bindAuthNavigation` (`window-manager.ts:878`) only intercepts
  `hydralauncher://auth` and `hydralauncher://update-account`; other navigations
  in the auth window are not blocked. Login is removed in v1.
- `src/main/helpers/external-url.ts` implements the correct allowlist
  (`http:`, `https:`). Reuse that policy in Rust and in the sidecar.

## 8. Preload and bridge

`src/preload/index.ts` imports only `contextBridge` and `ipcRenderer` from
Electron plus `node:crypto` (`randomUUID`). It exports a large object with:

- typed wrappers around `ipcRenderer.invoke` (350 unique literal channels);
- a four-channel `invokeCloudSaveOperation` wrapper;
- 71 literal `ipcRenderer.on` listeners plus six `const channel` listeners;
- matching `removeListener` calls.

In Tauri the preload is not a separate privileged world. The shim must:

- expose the same function names and argument order;
- route `invoke` through `ipc_invoke` with an allowlist;
- route `on`/`removeListener` through `listen("sphinx:ipc-event")` with a
  per-channel dispatch table;
- preserve the `JSON.stringify` result convention of
  `src/main/events/register-event.ts`;
- reject unknown channels with `channel_not_allowed`, not a silent no-op.

The preload also exposes `hydraApiCall` (arbitrary authenticated Hydra API
method/path) and `openExternal`. Both are renderer-controlled privileged
operations. `hydraApiCall` must be removed with the account features;
`openExternal` must be allowlisted in Rust.

## 9. Native and Node-only modules that stay in the sidecar

These are not Electron APIs, but they constrain the Tauri shell:

- `hydra-native.node` (N-API) — torrent, process listing, screenshots, cloud-save
  hashing/restore. It cannot be `require`d by Rust; keep it in the Node sidecar.
- `sharp` — image processing; verified under Node 24 in this audit.
- `classic-level` — LevelDB; verified under Node 24 in this audit.
- `node-7z`, `winreg`, `detect-drives`, `auto-launch` — Node/Windows helpers.
- `electron-log` — replace with a sidecar file logger.

`electron-builder.yml` currently uses `npmRebuild: false` and unpacks
`resources/**` and `sharp` (lines 32-35). The Tauri bundle must ship the same
native artifacts and the Node binary, and must not rely on `asar` unpacking.

## 10. Migration checklist derived from this audit

- [ ] Every window type has an explicit Tauri builder and a tested size/DPI
      behavior.
- [ ] `sandbox: false` and `nodeIntegrationInSubFrames` do not reappear.
- [ ] `local:` is scoped to app-owned directories; no arbitrary path reads.
- [ ] `gradient:` validates direction/colors and returns fixed SVG.
- [ ] `loadWindowURL` always serves the bundled renderer.
- [ ] `openExternal`/`openPath` have one shared `http(s)` policy in Rust and the
      sidecar.
- [ ] CORS/header rewriting is replaced by a proxy or proven unnecessary.
- [ ] Tray theme switching and custom window chrome are verified on Windows
      10/11.
- [ ] Power-save blocking, single-instance, deep link, autostart, and updater
      are Rust-owned.
- [ ] Crash logging is local-only; no Sentry/analytics.
- [ ] The sidecar owns `hydra-native`, `sharp`, `classic-level`, and LevelDB
      locks.

## 11. Evidence index

- `src/main/index.ts` — lifecycle, crash reporter, protocols, deep links,
  power monitor, shutdown.
- `src/main/services/window-manager.ts` — all window constructors, tray,
  navigation, CORS, URL loading.
- `src/main/services/achievement-notification-presenter-electron.ts` — overlay
  window.
- `src/main/services/power-save-blocker.ts` — display-sleep prevention.
- `src/main/services/screenshot.ts`,
  `src/main/services/linux-game-capture-session.ts` — desktop capture.
- `src/main/events/misc/open-external.ts`,
  `src/main/events/misc/show-open-dialog.ts`,
  `src/main/events/misc/clipboard-write-text.ts` — shell/dialog/clipboard.
- `src/main/events/misc/hydra-api-call.ts` — arbitrary authenticated API call.
- `src/main/helpers/external-url.ts` — correct URL allowlist.
- `src/main/events/user-preferences/auto-launch.ts` — autostart.
- `src/main/services/update-manager.ts`, `src/main/index.ts:54` — updater.
- `src/preload/index.ts` — bridge surface.
- `electron-builder.yml` — extraResources, asarUnpack, publish, npmRebuild.
