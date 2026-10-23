# Baseline Behavior Audit — Hydra 4.1.6

Baseline commit: `be492f5e3fc4a37c55d7df2b07faf5f9565c84dd`.
Audit date: 2026-10-23.
Scope: startup and quit, window/tray behavior, deep links, single-instance
handling, games running during close/crash, updates, logging, data locations,
and the Windows installer. No application code was changed by this audit.

This document records observed source behavior, not runtime acceptance. Runtime
checks are listed in section 10 and remain required before Fase 0 is complete.

## 1. Startup sequence

1. `crashReporter.start({ uploadToServer: false })` runs before app readiness;
   crash dumps stay local (`src/main/index.ts:51-53`).
2. The auto-updater feed is set to `hydralauncher/hydra` at module load
   (`src/main/index.ts:55-63`).
3. `app.requestSingleInstanceLock()` is requested; a second process calls
   `app.quit()` immediately (`src/main/index.ts:65-66`).
4. The `hydralauncher` protocol is registered as the default handler, including
   the development-executable path (`src/main/index.ts:81-105`).
5. `app.once("ready", initializeApp)` starts initialization
   (`src/main/index.ts:455-457`).
6. `initializeApp()`:
   - refreshes the portable shortcut launcher;
   - sets the Windows AppUserModelID to `gg.hydralauncher.hydra`;
   - registers `local:` and `gradient:` protocol handlers;
   - runs `loadState()`;
   - initializes Epic;
   - registers power suspend/resume handlers;
   - loads the saved language;
   - decides whether to create the main window, Big Picture, or no window;
   - always creates the tray;
   - handles the launch deep link.

   Evidence: `src/main/index.ts:107-228`.

`loadState()` is the real state bootstrap (`src/main/main.ts:69-226`):

- acquires a temp-file lock (`Lock.acquireLock`);
- runs achievement, cloud-save, emulator, and visibility migrations;
- opens user preferences and syncs Wine preferences;
- imports all IPC event modules;
- restores debrid tokens;
- copies Ludusavi config/binary into user data;
- on Linux, checks Decky and UMU updates;
- starts the Steam library watcher;
- initializes the Hydra API, starts download-source migration/sync, checks for
  download-source changes;
- if logged in, starts SSE, souvenir work, Steam sync, and Epic sync;
- bootstraps downloads and seeding;
- starts the main loop;
- on Windows, starts common-redistributable downloads;
- checks system paths.

Startup failures are partly tolerated:

- `loadState()` errors are logged, then startup continues
  (`src/main/index.ts:183-187`).
- Epic initialization errors are swallowed (`src/main/index.ts:189-191`), but
  `loadState()` also calls `initializeEpicIntegration()` inside
  `HydraApi.setupApi().then(...)` (`src/main/main.ts:124-126`). The audit did not
  prove that the double call is harmless; Fase 1 must not preserve it.
- `SystemPath.checkIfPathsAreAvailable()` only shows error dialogs; it does not
  terminate (`src/main/services/system-path.ts:15-35`, called at
  `src/main/main.ts:225`).
- `CommonRedistManager.downloadCommonRedist()` is called without a catch
  (`src/main/index.ts:221-223`). It downloads from
  `https://github.com/hydralauncher/hydra-common-redist/...` on Windows and can
  produce an unhandled rejection when offline
  (`src/main/services/common-redist-manager.ts:226-256`).

`Lock` is not a real mutex: `acquireLock()` truncates/writes a temp file and
never checks whether another process holds it
(`src/main/services/lock.ts:12-24`). Duplicate-launch prevention depends on
Electron's `requestSingleInstanceLock`, not this file.

The main window is not created until after migrations, `loadState`, Epic
initialization, and language loading. A hang in any of those leaves the app
without a window and without the tray, because the tray is created later.

## 2. Windows, close, and tray

Main window defaults (`src/main/services/window-manager.ts:108-142`):

- 1200 x 860, minimum 1024 x 600;
- hidden native frame with `titleBarStyle: "hidden"` and a 34 px title-bar
  overlay on Windows/macOS;
- frameless on Linux;
- `sandbox: false`;
- starts hidden (`show: false`), shown on `ready-to-show` unless Big Picture is
  requested.

Saved bounds are restored and fitted to the work area
(`window-manager.ts:297-340`). Closing the main window saves the screen config
and sets the instance to `null` (`window-manager.ts:434-467`). With the default
`preferQuitInsteadOfHiding = false`
(`src/renderer/src/pages/settings/settings-context-general.tsx:69`), close does
**not** hide the window; it destroys it. The process remains alive because
`window-all-closed` only clears the reference and does not call `app.quit()`
(`src/main/index.ts:395-397`). This is close-to-tray in effect: tray + background
services keep running, and the tray "Open" action creates a new window.

If `preferQuitInsteadOfHiding` is true, the close handler calls `app.quit()`
(`window-manager.ts:464-466`). That triggers the cleanup in section 4.

The tray is always created after the optional main window
(`src/main/index.ts:223`):

- tooltip is `"Hydra Launcher"` (`window-manager.ts:1398`);
- menu: Open, recently played games (max 6), Quit
  (`window-manager.ts:1328-1384`);
- Windows: double-click opens, right-click opens the menu
  (`window-manager.ts:1400-1411`);
- Linux: single click opens, right-click opens the menu
  (`window-manager.ts:1412-1423`);
- macOS: both click and right-click open the menu
  (`window-manager.ts:1424-1427`).

There is no setting in this audit that disables tray creation. Closing the
window while a download is active therefore leaves the download and seeding
services running.

## 3. Flags, Big Picture, and launch deep links

- `--hidden` suppresses the initial main window
  (`src/main/index.ts:219-221`).
- `--big-picture` forces Big Picture (`src/main/index.ts:216-220`).
- `launchInBigPicture` preference does the same
  (`window-manager.ts:329-340`).
- Big Picture is a fullscreen, frameless `BrowserWindow` with
  `sandbox: false` (`window-manager.ts:502-515`). While it is open, the main
  window is made non-focusable, mouse-ignored, hidden, and removed from the
  taskbar (`window-manager.ts:182-200`); closing Big Picture restores it
  (`window-manager.ts:542-546`).
- `launchToLibraryPage` selects the initial `library` route
  (`window-manager.ts:419-421`).
- `hydralauncher://run?shop=...&objectId=...` launches a game without showing
  the main window. `handleRunGame()` still creates the main window unless
  `hideToTrayOnGameStart` is enabled (`src/main/index.ts:251-292`).

## 4. Quit, games running, and crashes

`before-quit` is asynchronous and blocks the first quit
(`src/main/index.ts:399-441`):

1. `shutdownEpicIntegration()`; failure shows an error dialog and keeps the app
   open (`src/main/index.ts:407-419`).
2. cancel pending debrid preparation;
3. reset the power-save blocker;
4. `DownloadManager.pauseDownload()`;
5. in parallel: release lock, shut down the torrent service,
   `clearGamesPlaytime()`, stop emulator souvenir capture;
6. set `canAppBeClosed = true`, then call `app.quit()` again.

`will-quit` only logs (`src/main/index.ts:443-445`).

Crucially, there is **no check for a running game** in `before-quit`. Closing
the launcher while a game runs is allowed. The game process is not stopped.
`clearGamesPlaytime()` calls `onCloseGame()` for every tracked game
(`src/main/services/process-watcher.ts:819-829`), which:

- persists playtime and last-played time;
- schedules Steam/Epic exit sync;
- starts automatic cloud save on close
  (`process-watcher.ts:700-798`).

But `onCloseGame()` starts the automatic cloud save without awaiting it
(`process-watcher.ts:752-756`), and `before-quit` immediately continues to quit.
A slow cloud save can therefore be cut off. The baseline does not offer a
"wait for cloud save before quit" guarantee.

If the app is killed or crashes:

- `before-quit` does not run, so playtime is not flushed, the torrent service is
  not shut down gracefully, and no close cloud save runs;
- the game keeps running;
- on the next launch, the process watcher scans the OS process list and can
  start a new playtime session if the game is still running
  (`process-watcher.ts:380-431`); playtime between the crash and relaunch is not
  reconstructed;
- if the game already exited before relaunch, no close event is observed;
- download state resumes from the last persisted state
  (`src/main/main.ts:145-215`).

Renderer/main-process failures only log:

- `child-process-gone` logs type/reason/exit code
  (`src/main/index.ts:234-242`);
- `render-process-gone` logs reason/exit code
  (`src/main/index.ts:244-249`).

There is no automatic reload or recovery window. A renderer crash can leave a
blank/crashed window until the user restarts. `crashReporter` does not upload.

## 5. Deep links and second instance

Registered scheme: `hydralauncher` (`src/main/index.ts:81-105`).

Handled hosts (`src/main/index.ts:295-360`):

| Deep link                                                    | Behavior                            |
| ------------------------------------------------------------ | ----------------------------------- |
| `hydralauncher://run?shop=&objectId=`                        | Launch game; may create main window |
| `hydralauncher://install-source?...`                         | Redirect to Settings with query     |
| `hydralauncher://profile?userId=`                            | Redirect to profile                 |
| `hydralauncher://install-theme?theme=&authorId=&authorName=` | Redirect to theme install           |
| `hydralauncher://steam-connected?...`                        | Complete Steam OpenID connection    |

Second launch (`src/main/index.ts:362-386`):

- any deep link except `run` focuses/restores the existing main window, or
  creates one;
- `--big-picture` opens Big Picture;
- `run` deep links do not focus or create the window;
- the deep link is then handled.

macOS `open-url` is wired to the same handler (`src/main/index.ts:388-390`);
dock activation creates a main window when none exists
(`src/main/index.ts:447-453`).

Security note: `handleDeepLinkPath` trusts the `shop` query cast and passes
`install-source` query data to the renderer. It does not validate every deep
link field beyond URL parsing. `setWindowOpenHandler` opens **any** URL with
`shell.openExternal` and denies the in-app window
(`window-manager.ts:469-473`). Fase 1 should keep this behavior only with an
explicit scheme allowlist.

## 6. Updates

- Feed: GitHub `hydralauncher/hydra` (`src/main/index.ts:57-61`).
- Check interval: 50 minutes (`src/main/constants.ts:80`), started by the main
  loop (`src/main/services/main-loop.ts:44`).
- Only packaged builds call `autoUpdater.checkForUpdates()`; dev builds do not
  (`src/main/services/update-manager.ts:60-69`).
- Auto-download/auto-install is disabled for macOS, portable Windows builds, and
  Linux unless `enableAutoInstall` is true
  (`update-manager.ts:24-41`).
- Updates are published from GitHub (`electron-builder.yml:133-136`).

Sphinx must change the feed and publisher. Leaving the Hydra repository would
mix branding, signing, and release channels. The updater's `owner/repo` is
hardcoded, not derived from package metadata.

## 7. Logging and local data

Logging (`src/main/services/logger.ts:7-35`):

- `logsPath/network.txt` for network logs;
- `logsPath/achievements.txt` for the achievement scope;
- `logsPath/error.txt` for errors;
- `logsPath/info.txt` for info;
- `logsPath/logs.txt` for everything else;
- `electron-log` catches uncaught errors with `showDialog: false`.

`logsPath` is `<userData>/logs` (`src/main/constants.ts:37-40`). The package name
is `hydralauncher`; on Windows the default userData directory is under
`%APPDATA%`. Verify the actual path on first packaged run rather than assuming
it in the migration.

Local data (`src/main/constants.ts:27-71`):

| Data                            | Path                                                |
| ------------------------------- | --------------------------------------------------- |
| LevelDB                         | `<userData>/hydra-db`                               |
| Logs                            | `<userData>/logs`                                   |
| Backups / legacy cloud-save tar | `<userData>/Backups`                                |
| Assets                          | `<userData>/Assets`                                 |
| Themes                          | `<userData>/themes`                                 |
| Common redistributables         | `<userData>/CommonRedist`                           |
| Screenshots                     | `<userData>/Screenshots`                            |
| Crash dumps                     | `app.getPath("crashDumps")` (logged at startup)     |
| v2 cloud-save temp blobs        | `<temp>/hydra-cloud-saves/<snapshotId>/<hash>.blob` |

The LevelDB is a single `ClassicLevel` database opened at module load
(`src/main/level/level.ts:4-6`). A DB-open failure happens before the app's
error handling and can abort startup.

Network logs redact known secret fields and signed query parameters
(`src/main/services/network-log-payload.ts:4-48`), but they still record
request/response metadata. The migration must keep redaction and avoid logging
Google tokens or Drive URLs.

## 8. Windows packaging and NSIS

`electron-builder.yml`:

- `appId: gg.hydralauncher.hydra`, `productName: Hydra`
  (`electron-builder.yml:1-2`);
- Windows executable name `Hydra` (`electron-builder.yml:36-37`);
- Windows targets: `nsis` and `portable` (`electron-builder.yml:57-59`);
- NSIS:
  - `artifactName: ${name}-${version}-setup.${ext}`;
  - `shortcutName` and `uninstallDisplayName`: `Hydra`;
  - `createDesktopShortcut: always`;
  - `oneClick: false`;
  - `allowToChangeInstallationDirectory: true`;
  - custom `installer.nsh`.

  Evidence: `electron-builder.yml:60-67`.

- Portable: `${name}-${version}-portable.${ext}`, `unpackDirName: false`
  (`electron-builder.yml:68-70`).
- `npmRebuild: false` and an Electron download mirror at
  `https://npmmirror.com/mirrors/electron/` (`electron-builder.yml:132-138`).
  This is build-time supply chain, not runtime behavior.

`build/installer.nsh` only removes `%LOCALAPPDATA%\hydralauncher-updater` during
a real uninstall, not during an update (`build/installer.nsh:1-5`). There is no
`deleteAppDataOnUninstall` setting, so the app's userData (DB, logs, backups,
themes, assets) is retained after uninstall. Sphinx must decide whether to keep
that behavior or add an explicit data-removal option; silently deleting user
data would be a migration regression.

Portable behavior is not fully portable: the app detects
`PORTABLE_EXECUTABLE_FILE` (`src/preload/index.ts:1515`) and disables Windows
auto-install (`src/main/services/update-manager.ts:24-28`), but no code redirects
`userData` to the executable directory. A portable build still uses the normal
userData location.

## 9. Sphinx migration requirements

| Baseline behavior                                                       | Requirement                                                                               |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Single instance via Electron lock                                       | Reimplement one-instance guard and deep-link forwarding in Tauri                          |
| Tray always created; close destroys window but keeps process            | Preserve background downloads/seeding; document close vs quit                             |
| Close while game running allowed; playtime flush + cloud save scheduled | Preserve game-continues behavior; make cloud-save completion explicit or document the gap |
| Crash leaves game running, no flush                                     | Keep restart recovery; do not claim playtime/cloud-save durability on crash               |
| `hydralauncher://` deep links                                           | Register equivalent scheme(s) and validate every field                                    |
| `shell.openExternal` accepts any URL                                    | Restrict schemes/hosts                                                                    |
| 50-minute GitHub update check                                           | New Sphinx feed + signing; no Hydra feed                                                  |
| Logs in `<userData>/logs`, DB in `<userData>/hydra-db`                  | Keep paths/format or provide migration; no silent data loss                               |
| NSIS per-user assisted install, desktop shortcut always                 | Confirm Sphinx product name, shortcut, install scope                                      |
| Uninstall retains userData                                              | Decide explicitly; do not change without notice                                           |
| Portable build still uses userData                                      | Document or implement true portable mode                                                  |

## 10. Runtime verification required

- [ ] First packaged launch: startup order, window creation, tray presence.
- [ ] Close window: process and tray remain; downloads/seeding continue.
- [ ] Enable `preferQuitInsteadOfHiding`: close runs full cleanup and exits.
- [ ] Quit with a game running: game continues; playtime flushes; record whether
      automatic cloud save completes.
- [ ] Kill the main process with a game running: relaunch recovery, process
      watcher behavior, and download resume.
- [ ] Renderer crash: observe window state and recovery.
- [ ] Each deep link, including second-instance forwarding and
      `--big-picture`/`--hidden`.
- [ ] Update check against a non-Hydra test feed.
- [ ] Installer: directory choice, desktop shortcut, uninstall data retention,
      portable launch.
- [ ] Record results in `docs/MIGRATION_LOG.md` before claiming Fase 0 baseline
      verification.
