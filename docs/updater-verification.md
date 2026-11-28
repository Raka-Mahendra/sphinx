# Updater verification (Issue #2)

Issue #2 tracks the one thing this migration cannot prove offline: the in-app
update path has never run against a **published** release, because v0.1.0 was
the first release. This document records what _was_ verified in the tree, so
the remaining manual steps are the only unknown left.

It is a companion to `docs/release.md` — §7 explains what "restart = install"
means, §8 is the clean-machine test plan, and §9 is where the keypair lives.

## What was verified statically

The whole chain was read end to end. Every hop below exists and is wired; no
step is stubbed or TODO.

| Hop               | File                                                                                | What it does                                                                                                                                                                                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Renderer asks  | `src/renderer/src/components/header/auto-update-sub-header.tsx`                     | On mount, calls `window.electron.checkForUpdates()`; on click, `window.electron.restartAndInstallUpdate()`.                                                                                                                                                                    |
| 2. Preload        | `src/preload/index.ts`                                                              | Forwards both to `ipcRenderer.invoke("checkForUpdates" / "restartAndInstallUpdate")`.                                                                                                                                                                                          |
| 3. Main handlers  | `src/main/events/autoupdater/check-for-updates.ts`, `restart-and-install-update.ts` | Both call `UpdateManager`.                                                                                                                                                                                                                                                     |
| 4. Updater client | `src/main/services/update-manager.ts`                                               | RPC `updater.check` → emits `autoUpdaterEvent {type:"update-available"}` → RPC `updater.download` → emits `{type:"update-downloaded"}`; `restartAndInstallUpdate` → RPC `updater.install`. The renderer contract matches the Electron baseline (`src/types/index.ts:160-162`). |
| 5. RPC allowlist  | `src-tauri/src/sidecar/protocol.rs:280-283`                                         | `updater.check`, `updater.download`, `updater.install`, `updater.state` are all permitted.                                                                                                                                                                                     |
| 6. Shell dispatch | `src-tauri/src/sidecar/rpc.rs:91-112`                                               | Routes each to `updater.rs`.                                                                                                                                                                                                                                                   |
| 7. Rust updater   | `src-tauri/src/updater.rs`                                                          | See below.                                                                                                                                                                                                                                                                     |

### The shutdown ordering (the risky part)

`updater.rs` builds every updater through `build_updater()`, which attaches
`on_before_exit` (`updater.rs:104-125`). `check()` stores the returned `Update`
in `state.pending` (`updater.rs:177-179`), and `download()`/`install()` reuse
that same `Update` (`updater.rs:191-196`, `251-256`). Because it was built by
`build_updater`, its exit hook is attached.

On Windows `Update::install` spawns the installer and then calls
`std::process::exit(0)`. Just before that, `on_before_exit` runs
`shutdown_before_install()` on a short-lived thread (the hook is `Fn()`, and a
blocking shutdown on the runtime thread would panic). That calls
`supervisor.shutdown(SHUTDOWN_TIMEOUT_MS)` with a 12 s budget
(`updater.rs:36-40`), the same sequence a user quit runs — including
`torrentShutdown`, which flushes `.resume` data. Only after `node.exe` is reaped
does the installer replace files, so LevelDB and the torrent resume files are
never locked.

The ordinary exit path is also covered: `src-tauri/src/lib.rs:162-174` blocks on
the same `supervisor.shutdown` for `RunEvent::ExitRequested | Exit`.

### What the timeout buys

The 12 s budget is deliberate: a running torrent needs to flush resume data, and
a half-written `.resume` file costs the user a full re-check on the next start.
A `node.exe` that survives it is the failure mode §8's "Processes left behind"
row checks for.

## What was **not** verified

Nothing in this document has run against `releases/latest/download/latest.json`.
The following remain open until a release is published:

1. `updater.check()` actually resolving an `Update` from the published manifest.
2. The `.exe.sig` verifying against the committed `plugins.updater.pubkey`.
3. The installer running, the app exiting, the sidecar stopping first, and the
   version in the UI reading the new one after relaunch.
4. A second update (roll forward, roll back, roll forward again).

These are the steps listed in Issue #2 itself. Run them on a clean Windows 10
and Windows 11 machine using `docs/release.md` §8, then record the result on the
issue and close it.

## Related: Issue #5 (the signing secrets)

Issue #2 cannot be exercised end to end until a second release is published. The
workflow requires only `TAURI_SIGNING_PRIVATE_KEY`, and the key is passwordless,
so `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is intentionally unset (an unset GitHub
secret is an empty string, which Tauri accepts for this key). Whether the secret
is currently present **could not be verified** without repository
authentication; the preflight only checks that it is non-empty at run time. A
CI-signed build has not been produced yet, so it is still the missing proof.

`tauri-release.yml` still fails the build **before** it compiles anything when
the key secret is missing, with a pointer to `docs/release.md` §§1, 3 and 9,
instead of the previous cryptic "Signing updater artifacts requires a private
key" after ~15 minutes. That preflight checks presence only; the first real
proof of the secret is a signed build.

The one release run that exists,
[45978830327](https://github.com/Raka-Mahendra/sphinx/actions/runs/45978830327)
(tag `v0.1.0`, commit `e4239c55`), failed at `Build the bundle` — the step that
signs the updater artefact — which is **consistent with** a signing failure but
not proof of one: the job's sole failure annotation is
`Command "yarn tauri build" failed with exit code 1`, and the full log needs
repository authentication. That commit predates the `Require the updater signing
key` preflight, so the run proves nothing about the secret's presence. The
`v0.1.0` assets exist anyway, so they were uploaded outside that run; the
workflow's own signing path has still not succeeded. The published installer
bundles `node.exe` v24.22.1, not the CI-pinned v22.21.0, which corroborates that
the public 0.1.0 was built on the developer machine rather than by the workflow.

A non-publishing proof path is prepared:
`.github/workflows/tauri-signing-smoke.yml` (manual only, `contents: read`,
`workflow_dispatch` on `sphinx/main`) builds the real Windows package and signs
it with the existing key, then verifies the result with
`scripts/verify-updater-signature.mjs`. The verifier mirrors
`tauri-plugin-updater` (key ID, Ed25519 over the BLAKE2b-512 prehash or legacy
bytes, and the global signature) and was run against the published `v0.1.0`
installer: `signature_ok`, `global_signature_ok` and `manifest.ok` are all
`true`, with key ID `96C5E41CD0651543`. That validates the algorithm and the
keypair, **not** the secret's presence or the runner's ability to sign. The
smoke workflow has not run yet; pushing it needs owner authorization. See
`docs/release.md` §11.

The build itself no longer needs a developer `.env`: `scripts/build-sidecar.mjs`
defines every `MAIN_VITE_*` key the sources read and defaults it to `""` (see
`docs/release.md` §2). Before that fix a clean build produced a sidecar with no
IPC handlers at all, which would have made the update silently useless.
