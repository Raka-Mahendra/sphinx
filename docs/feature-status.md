# Feature status

Inventory of what Sphinx Launcher ships today, what is in the tree but not
finished, and what is not built at all. Based on the v0.1.0 build
(commit `e4239c55c`) and the migration log.

Three words, used consistently:

- **Shipped**: in the code and exercised in a running build, or covered by
  automated tests that run in CI.
- **Unfinished**: the code is there, but something is missing, disabled, or
  never run end to end. The gap is named.
- **Not built**: deliberately out of scope (PRD §2), or backlog (PRD §11).

When a row says "tested", it means a test exists and passes. A clean-machine run
is a separate column, because most of this build was never installed on a
machine that did not have Node, Rust, and Visual Studio.

## 1. Core

| Feature                                                       | State      | Evidence / gap                                                                    |
| ------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------- |
| Catalogue: Home shelves, genre rows, search, sort             | Shipped    | CDP run on v0.1.0; `docs/screenshots/home.png`, `catalogue.png`                   |
| Game page: screenshots, rating, genres, times to beat, specs  | Shipped    | CDP run; `game-detail.png`                                                        |
| Library: add, remove, covers, playtime, All/PC/Classics, sort | Shipped    | CDP run (add and remove GTA V); `library.png`                                     |
| Playtime tracking with a recovery scan after a sidecar crash  | Shipped    | `yarn test:crash` 34/34                                                           |
| Big Picture in a second window (`#/big-picture`)              | Shipped    | CDP run; `docs/screenshots/big-picture.png`                                       |
| Interface languages (more than 30) picked from the locale     | Shipped    | `src/locales/`, no test per language                                              |
| Themes: create, import, edit, delete                          | Shipped    | `src/renderer/src/pages/settings/appearance/`, no end-to-end test                 |
| Tray icon and menu                                            | Unfinished | `src-tauri/src/tray.rs` builds it; menu clicks never exercised                    |
| Single instance, `sphinx://run`, `--hidden`, `--big-picture`  | Unfinished | `src-tauri/src/platform.rs`; a real deep-link click never tested                  |
| Autostart at login, start minimised                           | Unfinished | `compute_startup` and the autostart plugin; clean-machine behaviour not verified  |
| In-app updater: check, download, install                      | Unfinished | Check and download work; the `0.1.0 → next` install never ran (no second release) |
| OS integration: dialogs, clipboard, open URL/folder, keychain | Shipped    | `src-tauri/src/{dialogs,clipboard,shell,keychain}.rs`, unit tests                 |
| IPC allowlist, strict CSP, restricted `local:` scheme         | Shipped    | `src-tauri/src/ipc/`, `docs/tauri-security.md`                                    |

## 2. Behind feature flags

All five flags in `src/shared/feature-flags.json` are `false`, and their 83 IPC
channels are stripped from the allowlist at build time. The code is still in the
tree so a future phase can turn it back on; in this build the features are not
reachable.

| Flag                     | Channels | What it hides                                                     |
| ------------------------ | -------: | ----------------------------------------------------------------- |
| `HYDRA_ACCOUNT_FEATURES` |       28 | Login, profile, friends, chat, reviews, collections, library sync |
| `ACHIEVEMENTS`           |       20 | Achievements, souvenirs, overlay, watcher, RetroAchievements      |
| `STEAM_INTEGRATION`      |        7 | Steam login, library sync, Steam playtime                         |
| `EPIC_INTEGRATION`       |       16 | Epic login, Legendary runtime, Epic downloads (assets removed)    |
| `HYDRA_CLOUD_LEGACY`     |       12 | Hydra cloud saves, legacy tar and v2 snapshots                    |

A renderer call to a gated channel fails with `feature_unavailable`, and a Rust
call is rejected with `channel_not_allowed` before it reaches the sidecar. See
`docs/feature-flags.md` for the enforcement points.

## 3. Unfinished

### 3.1 Torrent downloads

The engine, the queue, and the queue persistence are wired. No download has ever
been run through a packaged build. From `docs/torrent-tauri.md` §6:

| Criterion                                           | State                                                             |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| Magnet and `.torrent` download to a folder          | Unfinished, never run                                             |
| Progress, speed, peers and seeds                    | Unfinished, never run                                             |
| Pause, resume, cancel, delete with or without files | Unfinished, never run                                             |
| Select part of the files                            | Unfinished, never run                                             |
| Resume after restart without duplicates             | Partial: proven at process and queue level, not with real traffic |
| One engine per machine, port 5881 exclusive         | Shipped, `torrent-engine.test.ts` 4/4                             |
| No orphan process when the app quits                | Shipped, integration tests                                        |

The Downloads page in v0.1.0 only shows the empty state.

### 3.2 Cloud saves (Google Drive)

| Part                                              | State                                                             |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| Provider, commit protocol, dedupe, retention, GC  | Shipped, 43 tests in `src/main/services/google-drive/`            |
| OAuth with PKCE and refresh token in the keychain | Shipped, unit tests only                                          |
| Real login, upload, and restore against Drive     | Unfinished, never run                                             |
| v0.1.0 binary                                     | Disabled: built without `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` |

A build with both variables set turns it back on without code changes. A fork
with a different OAuth client does not share save data with this one.

### 3.3 Settings that look finished but were never exercised

These panels come from Hydra and compile. None of them has an end-to-end test in
this build.

- Debrid services: Real-Debrid, AllDebrid, TorBox, Premiumize
- Download sources: add a `.json` URL, sync, remove
- Emulation: console setup, ROM folders, BIOS, firmware, RetroArch, RPCS3,
  memory cards, local saves
- Common redistributables downloaded at boot from the Hydra CDN
- Network interface, max download speed, global trackers
- Proton and Wine prefix, default compatibility settings
- Automatic shortcuts after a download, extract by default, seed after download

### 3.4 Platform gaps

- Sleep blocking is not implemented. `src-tauri/src/power.rs` returns
  `supported: false` and logs once, so the display can go to sleep during a
  download. The Electron baseline kept it awake.
- Playtime is under-counted when the sidecar crashes mid-session. The recovery
  scan resumes the session but cannot rebuild the gap.
- Closing the app or running an update while a game is running was designed
  (job object, detached spawn) but not re-tested with this build.

### 3.5 Release and quality

- The release workflow has never run. It fails without
  `TAURI_SIGNING_PRIVATE_KEY` and its password; the repo only has Google secrets
  (issue #5).
- The `0.1.0 → next` update path has never run (issue #2).
- `yarn test` without a filter hangs on the Epic suites on Windows (issue #1).
  Use `yarn test:crash` and `yarn test:torrent`.
- 21 tests fail on Windows for environmental reasons (symlinks, path casing,
  archives). They are not regressions (issue #4).
- The sidecar logs full catalogue bodies, which makes `info.txt` grow fast
  (issue #3).
- The Sphinx logo has not had a human sign-off yet (phase 2 gate).

## 4. Not built

### 4.1 Cut by the PRD

- Local achievements. Achievement definitions come from Hydra's server.
- Epic without Hydra's server (backlog item 2).
- Hydra login, Sentry, analytics, and `workwonders-sdk`. Removed, not flagged.
- Python at runtime, in the build, or in CI. No `.py` file in the repo.

### 4.2 Platforms

- Linux has no build. Planned for phase 9, and `latest.json` has no Linux entry.
- macOS and mobile are out of scope.
- No portable build. On Windows the updater installs and exits, so "restart"
  means relaunch after the installer finishes.

### 4.3 Distribution

- The installer is not Authenticode signed. SmartScreen, Smart App Control, and
  Defender may warn.
- SmartScreen, Smart App Control, and Defender false positives were never tested
  on a clean machine.
- The PRD §6.1 checklist has not been run on clean Windows 10 and 11.
- No local minidump or crash dump for the Rust shell and the sidecar (backlog 6).

### 4.4 Backlog (PRD §11)

1. A source of local achievement definitions.
2. Epic with its own authentication, without Hydra's server.
3. Retire the sidecar: move the torrent engine to Rust over the same C++ bridge.
4. Authenticode signing, if SmartScreen blocks a release.
5. Linux (phase 9).
6. Local crash dumps for Rust and the sidecar.

## 5. Numbers

| Item                                  | Count                       |
| ------------------------------------- | --------------------------- |
| Feature flags off                     | 5, covering 83 IPC channels |
| Rust tests                            | 30 pass                     |
| Sidecar tests (`yarn test:crash`)     | 34 pass                     |
| Torrent process tests                 | 4 pass                      |
| Google Drive tests                    | 43 pass                     |
| Windows test failures (environmental) | 21                          |
| Open issues                           | #1 to #5                    |
| Releases                              | 1 (`v0.1.0`, 4 assets)      |

## Keeping this current

Update a row when the evidence changes, not when the code changes. A feature
moves to **Shipped** only after a test or a run on the installed build, and the
nickname of that evidence goes in the third column.
