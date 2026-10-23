# Epic Integration Audit — Hydra 4.1.6 baseline

Baseline commit: `be492f5e3fc4a37c55d7df2b07faf5f9565c84dd`.
Audit date: 2026-10-23.
Scope: prove which build/runtime assets are Epic-specific, which are shared,
and where the Epic service crosses other subsystems. No application code was
changed by this audit.

## 1. Result

Epic is a self-contained service with its own IPC namespace, build assets and
managed runtime, but it is **not isolated at the call-site level**. It is
imported by the download manager, cloud-save code, process watcher, launch
paths, library sync, and application lifecycle. A flag-only deletion of the
`src/main/services/epic` folder would break compilation.

The following assets are Epic-only:

| Asset | Produced by | Consumed by | Evidence |
| --- | --- | --- | --- |
| `hydra-epic-process.exe` | `scripts/prepare-epic-process-supervisor.cjs` from `native/windows-epic-process/supervisor.cs` | `src/main/services/epic/windows-process-job.ts` | `prepare-epic-process-supervisor.cjs:9-10, 77`; `windows-process-job.ts:10-11` |
| `hydra-epic-process.json` | same script (SHA-256 receipt) | same verifier | `prepare-epic-process-supervisor.cjs:10, 28-44` |
| `native/windows-epic-process/` | source folder | only the supervisor build | `prepare-epic-process-supervisor.cjs:76-80`; no other importer |
| `managed-legendary.pyz` | `scripts/legendary-managed-runtime.cjs` | `src/main/services/legendary.ts` | `legendary-managed-runtime.cjs:79-80, 162-165`; `legendary.ts:37-60` |
| `managed.py` | template copied by `legendary-managed-runtime.cjs` | `legendary.ts` | `legendary-managed-runtime.cjs:151-165`; `legendary.ts:37, 55-60` |
| `managed-runtime.json` | `legendary-managed-runtime.cjs` | `legendary.ts` capability/version check | `legendary.ts:19-42` |
| `scripts/prepare-legendary.cjs` | build-time downloader | `scripts/legendary-before-pack.cjs`, `package.json` `prepare:legendary` | `legendary-before-pack.cjs:2, 12-16`; `package.json:26, 30` |
| `legendary/` runtime tree | `prepare-legendary.cjs` | `Legendary.getBinaryPath()` | `electron-builder.yml:39-50, 100-115`; `legendary.ts:70-85` |

`prepare-legendary.cjs` is **Epic-only build tooling**. Its only production
caller is `scripts/legendary-before-pack.cjs`, which is registered as
`beforePack` in `electron-builder.yml:3`. It also runs from the root
`postinstall` script (`package.json:30`). That means a normal install/build can
download the Epic runtime even when the app is never used with Epic. This is a
packaging/network decision for Sphinx, not just a UI flag.

## 2. Python is only for Legendary's managed runtime

The bundled Python interpreter is part of the Legendary runtime. It is not used
by the torrent engine, catalogue, downloads, cloud save, or the core UI.

- `src/shared/legendary-manifest.json:55-101` defines the embedded Python
  3.13.16 artifacts for Windows x64/arm64 and Linux x64/arm64.
- `scripts/legendary-managed-runtime.cjs:170-183` installs
  `managed-native` and `python` into the Legendary directory and extracts the
  Windows Python zip there.
- `src/main/services/legendary.ts:56-60` chooses
  `legendary/python/python.exe` on Windows and `python-runner` on Linux, then
  runs `managed.py managed-legendary.pyz` through it.
- No other `src/main` service resolves that bundled interpreter.

One exception must be recorded: `src/main/services/umu.ts:82-83` locates the
system `/usr/bin/python3`/`python3` on Linux for UMU/Proton tooling. That is a
system interpreter outside Epic and outside the bundled Legendary runtime. It
does not make Python a shared application dependency, but it means the blanket
claim "the app has no Python" would be false.

## 3. Runtime shape

- 88 files under `src/main/services/epic`, including 38 test files.
- One IPC module: `src/main/events/epic/index.ts`, registering **16**
  `registerEvent` channels.
- All 16 channels validate the sender through
  `assertTrustedEpicSender` (`events/epic/index.ts:19, 28-143`).
- Channels cover connection/auth, sync, install options, Linux compatibility,
  download start, and Epic cloud-save state/sync/conflict resolution.
- The service is initialized during app startup:
  `src/main/index.ts:189-191` calls `initializeEpicIntegration()` and catches
  failure so Epic cannot block startup.
- Shutdown is awaited in `before-quit`; a failure keeps the app open and shows
  an error (`src/main/index.ts:402-431`).

The Epic start/download path uses a managed Legendary command, a Windows
process supervisor, and a separate Epic cloud-save protocol. This is a large
subsystem, not a thin store adapter.

## 4. Cross-cutting imports

These are the compile-time reasons the folder cannot simply be deleted:

| Consumer | Import/call | Evidence |
| --- | --- | --- |
| Download manager | `getEpicDownloadService`, `epicManagedErrorCode` | `services/download/download-manager.ts:12-13` |
| Disk-space calculation | `getReusableEpicDiskBytes` | `services/download/disk-space.ts:3` |
| Cloud save | `runWithHydraSaveGuard` | `services/cloud-save/sync-game-cloud-save.ts:41` |
| Cloud-save context | Epic Linux runtime | `services/cloud-save/cloud-save-game-context.ts:45` |
| Process watcher | Epic session policy, exit sync, playtime | `services/process-watcher.ts:4-6, 72-73` |
| Launch path | Epic launch/playtime integration | `services/epic/index.ts` and launch call sites |
| Library sync | Epic library/install records | `services/library-sync/*` and `services/epic/installation.ts` |
| Lifecycle | initialize/shutdown/suspend/resume | `src/main/index.ts:45-49, 189-201, 402-431` |
| Downloader enum | `Downloader.Epic = 15` | `src/shared/constants.ts:16` |

`Downloader.Epic` and the `epic` shop value must remain in types and local
records even when the feature is disabled, so old library data remains
readable (`PRD.md:177`). Disable behavior, do not rename persisted values.

## 5. Flag behavior

`EPIC_INTEGRATION` must gate the whole slice:

- do not register the 16 `events/epic` channels;
- do not call `initializeEpicIntegration()` or start sync/process watchers;
- hide Epic settings, store pages, install buttons, and cloud-save UI;
- return `feature_unavailable` for direct calls;
- make no Epic HTTP, Legendary, or Python process calls;
- keep existing bookkeeping values readable.

Build-time behavior needs a separate decision. If Sphinx ships with Epic
permanently disabled, `prepare:legendary` and `legendary-before-pack.cjs`
should not download or package the Epic runtime. If the flag is runtime-only,
the package still contains the runtime and `postinstall` still downloads it.
The latter contradicts a strict "no unexpected outbound network" build.

## 6. Removal order (Fase 1)

1. Add the flag and typed loader first.
2. Gate IPC registration and `initializeEpicIntegration()`.
3. Replace direct cross-imports with feature-neutral interfaces or guarded
   stubs. In particular, do not let `download-manager.ts` or
   `cloud-save/sync-game-cloud-save.ts` call Epic when the flag is false.
4. Remove Epic UI entry points and settings.
5. Remove `prepare:legendary` from `postinstall`; make `beforePack` conditional
   on the Epic build variant.
6. Only after no imports remain, delete the Epic service, events, native
   supervisor, and build scripts.
7. Keep `Downloader.Epic = 15` and the `epic` shop enum for data
   compatibility.

## 7. Verification required

- [ ] Build with `EPIC_INTEGRATION=false` and confirm no Epic channel is in the
      generated allowlist.
- [ ] Confirm startup makes no `/profile/integrations/epic`, Epic GraphQL,
      Legendary, or Python call when the flag is false.
- [ ] Confirm a library containing `Downloader.Epic` records still loads.
- [ ] Confirm `hydra-epic-process.exe`/`managed-legendary.pyz` are absent from
      the Sphinx package if Epic is permanently disabled.
- [ ] Record results in `docs/MIGRATION_LOG.md` before claiming Fase 0 Epic
      verification.
