# Dependency allowlist — sisa `electron`, `sentry`, `analytics`, `workwonders`

Fase 8 removes Electron as a runtime, as packages, and as a build path. This
document lists every remaining occurrence of the four keywords so
`grep -ri electron`, `grep -rni sentry`, `grep -rni analytics` and
`grep -rni workwonders` can be read without suspicion — and so a new occurrence
is immediately visible as a regression.

Updated: 26 November 2026, Fase 8 (PRD §4.A, §4.B, fase 8).

## 1. What Fase 8 deleted

| Deleted                                                                             | Note                                                                                    |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `electron`, `electron-builder`, `electron-vite`, `electron-log`, `electron-updater` | Dependencies and their lockfile entries                                                 |
| `@electron-toolkit/preload`, `-utils`, `-tsconfig`, `-eslint-config-*`              | Dependencies; the ESLint rule set and `tsconfig` options now live in the project files  |
| `electron-builder.yml`, `electron.vite.config.ts`, `build/`                         | Builder and resource configuration                                                      |
| `src/main/index.ts`                                                                 | Electron bootstrap: single instance, protocol, tray, windows, `crashReporter`           |
| `electron:dev`, `electron:start`, `electron:build*` scripts                         | Replaced by `dev`/`build` (Tauri)                                                       |
| `.github/workflows/build.yml`, `release.yml`, `build-renderer.yml`                  | Replaced by `tauri-release.yml`                                                         |
| `.github/workflows/trigger-lp.yml`, `update-aur.yml`                                | Upstream Hydra infrastructure (landing page, AUR)                                       |
| `ELECTRON_RENDERER_URL`                                                             | Replaced by `SPHINX_RENDERER_URL`, set by `src-tauri/src/sidecar/config.rs`             |
| `scripts/legendary-*.cjs`, `prepare-legendary.cjs`, `*-managed*.py`, related tests  | Legendary/Python packaging; nothing in the build or CI calls them any more              |
| `scripts/build-epic-prerequisite-runner.cjs`, `test-epic-prerequisite-wine.cjs`     | Epic prerequisite helper packaging                                                      |
| `scripts/prepare-epic-process-supervisor.cjs` and its test                          | Builds `hydra-epic-process.exe`, which must not ship                                    |
| `resources/legendary/` (Python, shell helpers, `.pyz` bootstrap)                    | No build step reads it; the runtime is not bundled                                      |
| `yarn.lock` Electron graph                                                          | Pruned by `yarn install`; the lockfile no longer resolves any Electron package (see §2) |

`yarn install --frozen-lockfile` passes on the pruned lockfile.

## 2. `electron` that is legitimate

`grep -ril electron --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=out --exclude-dir=target --exclude-dir=gen .`
matches these categories. None loads an Electron runtime.

| Category                                 | Locations                                                                                                              | Why it is legitimate                                                                                                                                                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidecar shim                             | `src/sidecar/electron-shim/**`                                                                                         | This **is** the replacement: `ipcMain`, `BrowserWindow`, `app`, `dialog`, `shell`, `session`, `Notification`, `Tray`, `Menu` implemented over RPC to Rust. Unimplemented members throw `NotImplementedInShim: <api>` |
| `import … from "electron"` in `src/main` | `src/main/**` (≈78 files)                                                                                              | PRD A1: `src/main` runs unchanged as a sidecar; esbuild aliases the specifier to the shim, and `tsconfig` maps the same specifier so the compiler checks what really runs                                            |
| `window.electron` bridge                 | `src/preload/index.ts`, `src/renderer/**`, `src/big-picture/**`                                                        | PRD A2: the preload is reused byte-identical; Vite aliases `electron` to `src/tauri-bridge/electron.ts`, which runs on `invoke`/`listen`. `window.electron` is the public API of 748 call sites                      |
| Renderer bridge types                    | `src/types/electron-globals.d.ts`                                                                                      | Declares `Electron.IpcMainInvokeEvent`, `Electron.NativeImage`, `process.resourcesPath`, etc., because the Electron package that supplied them is gone                                                               |
| Build aliases                            | `vite.config.ts`, `vite.config.big-picture.ts`, `tsconfig.node.json`, `tsconfig.web.json`, `.eslintrc.cjs`             | Point the specifier at the shims/rule set that replaced the package                                                                                                                                                  |
| Build scripts                            | `scripts/build-sidecar.mjs`, `scripts/build-native-addon.cjs`                                                          | Alias `electron` to the shim; `?asset` handling; comments about the old loader                                                                                                                                       |
| OTA bridge check                         | `scripts/check-ota-bridge.mjs`, `scripts/check-ota-bridge.test.mjs`                                                    | Verifies renderer uses of `window.electron.*` exist in the shipped preload; it is about the bridge, not the Electron package                                                                                         |
| Rust comments                            | `src-tauri/src/{lib,tray,dialogs,shell,keychain,notifications}.rs`, `src-tauri/src/sidecar/{config,protocol}.rs`       | Behaviour-parity notes ("Electron did X here")                                                                                                                                                                       |
| Documentation                            | `docs/**`, `PRD.md`, `README.md`, `LICENSE`                                                                            | Audit archive, policy, and the Apache-2.0 text ("electronic" in the licence wording)                                                                                                                                 |
| Third-party binaries and notices         | `binaries/7z*.dll/.exe`, `native/torrent-bridge/prebuilt/**`, `hydra-native/**`, `resources/epic/UMU-DATABASE-LICENSE` | Binary/notice files of other projects; the byte string is not our code                                                                                                                                               |
| Lockfile data                            | `yarn.lock`                                                                                                            | Exactly one package: `electron-to-chromium`, the browserslist browser-data table used by `@babel`/`browserslist`                                                                                                     |

## 3. `sentry`

After Fase 8 there is **no** Sentry dependency, DSN, initialisation, plugin or
config file. Remaining matches are documentation only:

| Location  | Content                       | Why legitimate    |
| --------- | ----------------------------- | ----------------- |
| `PRD.md`  | The requirement to remove it  | Planning document |
| `docs/**` | Audit notes about the removal | Migration archive |

Binary matches in `binaries/`, `hydra-native/` and
`native/torrent-bridge/prebuilt/` are unrelated third-party byte strings.

## 4. `analytics`

| Location                 | Content                       | Why legitimate                                                                                             |
| ------------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/main/vite-env.d.ts` | `MAIN_VITE_ANALYTICS_API_URL` | Build-time variable name inherited from the baseline; its value is a catalogue API endpoint, not telemetry |
| `docs/**`, `PRD.md`      | Audit notes                   | Archive                                                                                                    |

There is no analytics SDK in `package.json`, and no outbound telemetry call in
`src/main`. See `docs/network-calls.md` for the calls that do exist.

## 5. `workwonders`

| Location                         | Content                                                                 | Why legitimate                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/locales/*/translation.json` | i18n **key** `setup_install_guide_workwonders`                          | Key names are shared across locales; the value is "Open the Sphinx install guide". No SDK, no request |
| `docs/**`                        | `account-dependent-features.md`, `network-calls.md`, `feature-flags.md` | Archive: records that the SDK and `workwondersJwt` were removed                                       |

There is no `workwonders-sdk` package and no connection to `workwonders.app`.

## 6. Re-checking

```bash
grep -ril "electron" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=out --exclude-dir=target --exclude-dir=gen .
grep -rin "sentry" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=out --exclude-dir=target .
grep -rin "analytics" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=out --exclude-dir=target .
grep -rin "workwonders" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=out --exclude-dir=target .
```

Expected: only the categories above. A new `import … from "electron-log"`, a
`@electron-toolkit/*` entry, `electron-builder`, `@sentry/*`, an analytics SDK,
`workwonders-sdk`, or a `.py`/`.pyz` build script means a dependency came back
and must be rejected.

`yarn.lock` must contain **no** Electron package; the only allowed match is
`electron-to-chromium`:

```bash
grep -n "electron" yarn.lock
```
