# Sidecar architecture — `src/sidecar` and the Rust supervisor

Fase 4 (PRD §4.A.2–§4.A.5). This document describes what was built, what was
deliberately not, and how to verify each claim.

## 1. Why a sidecar

`src/main` is 1 300 files of TypeScript that talks to LevelDB, libtorrent, a
N-API addon, `sharp` and a dozen Windows APIs. Porting it to Rust is not a
migration, it is a rewrite. The PRD keeps it in a Node process and puts only the
shell in Rust.

```
┌─────────────────────────────────────────────┐
│ Webview (main / big-picture)                │
│  src/preload/index.ts  — reused verbatim    │
│  src/tauri-bridge        — electron → Tauri │
└───────────────┬─────────────────────────────┘
                │ invoke("ipc_invoke", {channel, args})
┌───────────────▼─────────────────────────────┐
│ Rust shell  (src-tauri)                     │
│  allowlist gate · supervisor · dialogs      │
└───────────────┬─────────────────────────────┘
                │ JSON Lines over stdin/stdout
┌───────────────▼─────────────────────────────┐
│ Node sidecar  (out/sidecar/index.mjs)       │
│  src/main  — the baseline, unchanged        │
│  electron-shim — what Electron did          │
└─────────────────────────────────────────────┘
```

## 2. The wire protocol

One JSON object per line on stdin/stdout; stderr is the sidecar's own log.
Both directions carry request ids, because both sides initiate:

| Direction      | Messages                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------- |
| Rust → sidecar | `invoke`, `send`, `rpc-result`, `control` (ping / shutdown / window-attached / window-detached) |
| sidecar → Rust | `ready`, `result`, `error`, `event`, `rpc`, `heartbeat`, `shutdown-complete`                    |

The full schema is `src/sidecar/protocol.ts` and `src-tauri/src/sidecar/protocol.rs`.
`PROTOCOL_VERSION` is checked on `ready`; a mismatch kills the sidecar instead of
mis-parsing it.

`webContents.send(channel, ...args)` becomes one `event` message whose `payload`
is the argument array, so multi-argument sends survive. Rust re-emits it as
`sphinx:ipc-event`, and the bridge dispatches per channel.

**Serialization contract preserved.** `register-event.ts` wraps every handler
result in `JSON.parse(JSON.stringify(result))`, so handlers already return plain
JSON. Tauri does the same on the way out. No structured-clone surprises.

## 3. The electron shim

esbuild aliases `electron` to `src/sidecar/electron-shim/index.ts`. The rule is
in the PRD: implement what the code uses, throw `NotImplementedInShim: <name>`
for everything else. A silent no-op inside a download or playtime path is a
data-loss bug.

Implemented over the RPC channel:

| API                                                                            | Backed by                                                               |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `app.getPath` / `setPath` / `getVersion` / `isPackaged`                        | `SPHINX_*` environment variables, resolved synchronously at module load |
| `ipcMain.handle` / `on` / `once` / `removeHandler`                             | the protocol dispatcher                                                 |
| `BrowserWindow`                                                                | a proxy; `window.create` / `window.call` in Rust                        |
| `dialog.showOpenDialog` / `showSaveDialog` / `showMessageBox` / `showErrorBox` | `tauri-plugin-dialog`                                                   |
| `shell.openExternal` / `openPath` / `showItemInFolder`                         | the `open` crate, behind the `http:`/`https:` allowlist                 |
| `net.fetch`                                                                    | Node's global `fetch`                                                   |
| `clipboard.writeText`                                                          | `arboard`                                                               |
| `screen.getPrimaryDisplay` / `getAllDisplays` / `getDisplayMatching`           | `SPHINX_DISPLAYS`                                                       |
| `keychain.*`                                                                   | the `keyring` crate                                                     |

Deliberately **not** implemented, with the consequence:

| API                  | Consequence                                                                                                                                                                      | Tracked |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `session.webRequest` | CORS/UA header rewriting for artwork is gone. `window-manager.ts:342` logs once at start-up. Fase 5 must decide between a sidecar proxy and accepting WebView2's CORS behaviour. | Fase 5  |
| `nativeImage`        | screenshots and chat task-bar badges cannot be built synchronously.                                                                                                              | Fase 6  |
| `desktopCapturer`    | desktop capture.                                                                                                                                                                 | Fase 6  |
| `Notification`       | "new repacks" notifications are logged, not shown. `tauri-plugin-notification` is the Fase 6 answer.                                                                             | Fase 6  |
| `powerSaveBlocker`   | the display may sleep mid-download.                                                                                                                                              | Fase 6  |
| `Tray`               | throws. The tray is Rust-owned (Fase 5).                                                                                                                                         | Fase 5  |
| `protocol.handle`    | `local:` and `gradient:` schemes.                                                                                                                                                | Fase 5  |

`electron-log` is replaced by `src/sidecar/electron-shim/logger.ts`, which keeps
the baseline file split (`info.txt`, `error.txt`, `network.txt`,
`achievements.txt`) and the `scope` routing. One intentional difference: an
uncaught exception **exits** the process so the supervisor can restart it, while
Electron's version kept running. `setFatalExitEnabled(false)` disables that
during shutdown so a teardown failure is not reported as a crash.

`@electron-toolkit/utils` is replaced by a 20-line shim: `is.dev` reads
`isPackaged`, `setAppUserModelId` and `watchWindowShortcuts` are no-ops because
Rust owns both now.

### Window proxies

`src/main/services/window-manager.ts` keeps constructing `BrowserWindow`s, but
in Tauri the shell owns windows. The shim's `BrowserWindow` is a proxy:

- construction records the options;
- the first `loadURL`/`loadFile` triggers `window.create`, because a Tauri
  window needs its URL at creation time;
- every other method becomes `window.call`;
- `webContents.send` becomes a protocol `event`.

`WindowManager.attachExternalWindow(label, window)` was added so the sidecar can
adopt the windows Rust creates (`window-attached`). Without it, `mainWindow` and
`bigPicture` stay null and every `sendToAppWindows` silently drops.

`getBounds`, `isMinimized`, `isMaximized` and friends return the last state
reported by the shell. `setOpacity`, `setFocusable` and `setProgressBar` return
`not_implemented` — pretending to succeed is worse.

Two details a window proxy cannot get right on its own, both found by running
`yarn tauri dev`:

**The label is the capability boundary.** In Tauri a window is identified by its
label, and `capabilities/default.json` grants the IPC commands per label. A
window the sidecar creates without one gets `sphinx-window-<n>`, which no
capability covers, so every command in it is rejected. `new BrowserWindow(...)`
therefore accepts a `label`, and `openBigPictureWindow` passes
`label: "big-picture"`. `WindowManager` types it as
`BrowserWindowConstructorOptions & { label?: string }`, because Electron's own
type has no such field.

**`ready-to-show` has to come from the shell.** Every auxiliary window is created
with `show: false` and shown from `ready-to-show`. Electron fires that event when
the renderer painted its first frame; the sidecar cannot know that, so Rust
attaches `on_page_load` to each window it creates and sends
`control window-ready` on `PageLoadEvent::Finished`. The sidecar turns it into
`emit("ready-to-show")`. Without this the Big Picture window exists, loads, and
stays invisible forever — which is exactly what happened before the fix.

### The Node binary

`src-tauri/tauri.conf.json` declares `bundle.externalBin: ["binaries/node"]`, so
the installer ships the Node that runs the sidecar instead of requiring one on
the user's machine. The file is ~80 MB, so it is not committed:
`yarn stage:node` (`scripts/stage-node-binary.mjs`) copies the running Node into
`src-tauri/binaries/node-<host-triple>.exe`, which `src-tauri/.gitignore`
excludes. `yarn build` runs it first.

`sidecar/config.rs` looks for the binary next to the executable (that is where
Tauri puts an external binary) and falls back to `<resources>/node/node.exe`.
In development it uses `SPHINX_NODE_BINARY` if set, otherwise `node` from
`PATH` — which is why `yarn dev` needs no staging step.

## 4. The supervisor

`src-tauri/src/sidecar/mod.rs`. Five rules, each from PRD §4.A.4:

| Rule                     | Implementation                                                                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordered shutdown         | `control shutdown` → the sidecar runs `torrentShutdown` (resume data), `clearGamesPlaytime`, `db.close()` → `shutdown-complete` → only then `start_kill` + `wait`                      |
| Wait for the old process | `wait_for_exit` polls `try_wait` until the child is reaped; the next spawn happens after that. LevelDB takes an exclusive lock, and two torrent engines on one resume file corrupt it. |
| Heartbeat                | ping every 3 s, timeout 12 s. A wedged sidecar is killed.                                                                                                                              |
| Restart budget           | 3 restarts per 60 s, then `GaveUp` and a "Try again" dialog.                                                                                                                           |
| In-flight rejection      | pending requests fail with `sidecar_restarted`; the bridge shows the reconnect indicator.                                                                                              |

A hook that throws during shutdown is recorded in `failures` and does not stop
the remaining hooks: a stuck torrent flush must not prevent LevelDB from closing.

The reconnect indicator lives in `src/tauri-bridge/reconnect-indicator.ts`. The
preload is reused unchanged, so no component knows the sidecar exists; the bridge
owns the banner. It appears when an `invoke` fails with a transport code and
disappears on the next success or when the shell reports `ready`.

## 5. Recovery scan

`src/sidecar/recovery.ts`, run once per start:

- `watchProcesses({ resumed: true })` — the baseline's own process scan, marked
  so the log can tell "the user launched this" from "this was already running".
- `setGamePlaytime` now generates a `sessionId` per session and carries a
  `resumed` flag. Neither is persisted, per the PRD.
- the download queue is counted and reported; `loadState()` rebuilds it from the
  same LevelDB keys, so it is not re-created here.
- the playtime between a crash and the next start is **not** reconstructed. The
  baseline did not either, and backfilling would be a lie.

## 6. Games survive the sidecar

`src/main/helpers/launch-game.ts` already spawns games with
`{ detached: true, stdio: "ignore" }`, so a game is never a child of the
sidecar's process tree. Crash test 1 in
`src/sidecar/crash-recovery.test.ts` kills the sidecar and asserts the game is
still alive.

Tauri itself does not put the app's children in a job object, so there is
nothing on the Rust side to change. The one thing to re-check is the updater
(Fase 4.E): an update installs while the sidecar is gone, and a running game
must not be stopped by it.

## 7. Verification

| Claim                    | Command                          | Result                                 |
| ------------------------ | -------------------------------- | -------------------------------------- |
| Sidecar bundles          | `yarn build:sidecar`             | 7.6 MB, 963 modules, 74 externals      |
| Sidecar boots and serves | `src/sidecar/rpc.test.ts`        | 12/12 pass                             |
| Allowlist matches source | `src/sidecar/allowlist.test.ts`  | 9/9 pass                               |
| Crash behaviour          | `yarn test:crash`                | 4/4 pass                               |
| Allowlist is current     | `yarn gen:ipc-allowlist --check` | 346 invoke, 71 event, 6 dynamic prefix |
| Rust compiles            | `cargo check --all-targets`      | clean                                  |
| Renderer builds          | `yarn build:renderer`            | built                                  |
| Big Picture builds       | `yarn build:big-picture`         | built                                  |

`cargo test` compiles the test binary but **cannot run it on this machine**: the
executable imports `api-ms-win-core-path-l1-1-0.dll`, which this Windows
installation does not have. The four supervisor tests (`record_restart`,
`is_stalled`) are pure functions and will run on a standard Windows 10/11
install; the same class of limitation is recorded in `docs/tauri-shell.md` for
Fase 3.

### Test-only hook

`SPHINX_TEST_FREEZE_MS` blocks the sidecar's event loop for that many
milliseconds after `ready`. It exists so the heartbeat watchdog has a real hang
to detect; nothing else sets it.

### What this machine could not verify

Two gaps, both environmental, both stated here instead of hidden in a skip:

- **`hydra-native.node` is not built.** `napi-build` refuses with
  `libnode.dll not found in any search path` (`napi-build-2.3.1/src/windows.rs:15`),
  and neither Node distribution on this machine ships `libnode.dll` or `node.lib`.
  Building it needs the MSVC toolchain this session does not have. Consequences:
  torrents and download execution are inert, and the process scan inside the
  recovery scan throws — `loadState` logs
  `Sphinx native addon not found at .../hydra-native/hydra-native.node` and boot
  continues, which is the intended degradation. Crash test 1 detects this and
  asserts the weaker claim (game survives, report exists) instead of pretending
  the resume half ran.
- **`ludusavi/ludusavi.exe` is not in the repo.** `Ludusavi.copyBinaryToUserData()`
  rejects with `ENOENT` at boot. The baseline has the same uncaught rejection
  (`docs/baseline-behavior.md` §1); it is why the shim's error handler does not
  exit the process on an uncaught rejection.

`sharp` and `classic-level` do load in the bundled Node: the recovery scan reads
LevelDB through `classic-level` on every start (`recovery {...}` in the log), and
the sidecar bundle resolves both as external dependencies.
