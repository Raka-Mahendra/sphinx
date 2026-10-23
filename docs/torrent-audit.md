# Torrent and Download Engine Audit — Hydra 4.1.6 baseline

Baseline commit: `be492f5e3fc4a37c55d7df2b07faf5f9565c84dd`.
Audit date: 2026-10-23.
Scope: the torrent boundary, native addon, download state machine, listen
surface, and packaging. No application code was changed by this audit.

The migration rules forbid replacing or modifying the torrent engine,
`DownloadManager`, status handling, or seeding. This document records what
must be preserved and where the native boundary is.

## 1. Boundary

```
DownloadOrchestrator / events
        ↓
DownloadManager (src/main/services/download/download-manager.ts)
        ↓
TorrentService (src/main/services/torrent-service.ts)
        ↓
TorrentClient (src/main/services/torrent-client.ts)
        ↓
NativeAddon (src/main/services/native-addon.ts)
        ↓
hydra-native.node (Rust N-API, native/hydra-native)
        ↓
hydra_torrent_bridge{.dll,.so} (C ABI, native/torrent-bridge)
        ↓
libtorrent
```

Evidence:

| Layer | Evidence |
| --- | --- |
| `TorrentService` adapter | `src/main/services/torrent-service.ts:4-8` |
| `TorrentClient` methods and timeouts | `src/main/services/torrent-client.ts:1-3, 6-8, 39-113` |
| Native addon resolution | `src/main/services/native-addon.ts:242-261` |
| Torrent N-API exports | `src/main/services/native-addon.ts:226-236` |
| C ABI bridge | `native/torrent-bridge/bridge.cpp:1-70` |
| Rust binding/validation | `native/hydra-native/src/torrent/` |

The port number **5881 is the BitTorrent listen port**, not a local HTTP
control port. Control calls go through the N-API `torrentInitialize`,
`torrentRequest`, and `torrentShutdown` functions with JSON strings.

## 2. Control contract

`TorrentClient` exposes exactly four method names
(`src/main/services/torrent-client.ts:5-8`):

- `status`
- `seed_status`
- `torrent_files`
- `action`

`action` payloads used by the baseline
(`src/main/services/download/download-manager.ts`):

| Action | Evidence | Purpose |
| --- | --- | --- |
| `start` | `:398, 2349, 2370-2497, 3191-3194` | Add/start a torrent, including selective files |
| `pause` | `:1501` | Pause active download |
| `cancel` | `:1611, 1631, 3153` | Remove/cancel a torrent |
| `resume_seeding` | `:1639` | Resume seeding after completion |
| `pause_seeding` | `:1649` | Pause seeding |
| `set_download_limit` | `:443-447` | Apply speed limit |
| `set_network_interface` | `:487-491` | Apply interface binding |

The request wrapper serializes parameters with `JSON.stringify` and parses a
`{ result }` or `{ error: { code, message } }` response
(`src/main/services/torrent-client.ts:82-95`). Errors become `TorrentError`;
shutdown rejects all pending calls with `torrent_shutdown`.

## 3. Listen binding and exposure

The bridge sets libtorrent's listen interface to **`0.0.0.0:<port>`** when no
interface is configured:

- `native/torrent-bridge/bridge.cpp:39`:
  `listen_interfaces = "0.0.0.0:" + port`
- `native/hydra-native/src/torrent/validation.rs:110-126`: an empty interface
  resolves to `0.0.0.0:<port>`; a configured value is split into addresses and
  gets `[addr]:port` or `addr:port`.

`TorrentClient.initialize()` calls the backend with port `5881`
(`src/main/services/torrent-client.ts:39-44`). `DownloadManager` can change the
binding through `set_network_interface`
(`src/main/services/download/download-manager.ts:467-491`), but if the user has
no preference the **all-interfaces** default remains.

Consequences:

- The BitTorrent listener is reachable from other hosts on the LAN unless the
  OS firewall blocks it. This is normal libtorrent behavior but must be
  documented for users and for the Tauri sidecar.
- There is no authentication or TLS on this listener. It speaks the BitTorrent
  protocol, not a private RPC.
- The Tauri shell must not expose this port through a webview or an HTTP
  command. Only the sidecar/native addon should own it.
- The migration must preserve the current bind behavior unless the PRD is
  explicitly changed. A future hardening change should be a separate decision,
  not an accidental regression.

## 4. Timeouts and lifecycle

| Item | Value | Evidence |
| --- | ---: | --- |
| Default request timeout | 10 s | `torrent-client.ts:2` |
| Minimum request timeout | 1 s | `torrent-client.ts:3` |
| Normal torrent start | 10 s | `download-manager.ts:107` |
| Selective torrent start | 60 s | `download-manager.ts:108` |
| Initialize | `TorrentClient.initialize` | `torrent-client.ts:39-49` |
| Shutdown | marks closing, rejects pending, awaits backend | `torrent-client.ts:101-113` |
| Quit integration | `TorrentService.shutdown()` in `before-quit` | `src/main/index.ts:427-432` |

`DownloadManager.initializeTorrentService` initializes the service, applies the
network interface, resumes seeding downloads, and starts a pending download
(`download-manager.ts:498-520`). On startup, `main.ts` also computes which
completed downloads should seed, checks missing files, and passes them to the
orchestrator (`src/main/main.ts:145-184`).

## 5. Download state and seeding

`DownloadStatus` includes `active`, `waiting`, `paused`, `error`, `complete`,
`seeding`, `removed`, and `extracting`
(`src/types/download.types.ts:3-13`). `isSeedingDownload` returns true when
`status === "seeding"` or `shouldSeed` is set
(`src/types/download-contract.ts:63-72`).

The baseline treats a completed torrent as seedable and persists `shouldSeed`
on the download record (`src/types/level.types.ts:132`). Seeding status is
polled with the `seed_status` RPC and broadcast to windows
(`download-manager.ts:1424-1472`). Do not rename these fields or change the
seeding lifecycle during the shell migration.

The queue, pause/resume, selective files, and extraction transitions live in
`src/main/services/download/download-manager.ts`. They are outside the scope of
the Tauri rewrite and must remain in the Node sidecar.

## 6. Packaging and native assets

- The addon is loaded from
  `process.resourcesPath/hydra-native/hydra-native.node` in a packaged app,
  otherwise from `app.getAppPath()/hydra-native/hydra-native.node`
  (`native-addon.ts:242-251`).
- If the file is missing, the addon throws
  `Hydra native addon not found at <path>` (`native-addon.ts:260-261`).
- `electron-builder.yml:8-11` copies `hydra-native` as an extra resource.
- `scripts/build-native-addon.cjs:20-31` writes `hydra-native/hydra-native.node`.
  On Windows it also requires MSVC/VC redistributable DLLs and `vswhere`
  (`scripts/build-native-addon.cjs:55-96`).
- Prebuilt torrent bridge artifacts exist for x64 Linux and x64 Windows:
  `native/torrent-bridge/prebuilt/x64-linux/lib/libhydra_torrent_bridge.so`,
  `native/torrent-bridge/prebuilt/x64-windows-static/bin/hydra_torrent_bridge.dll`,
  and the corresponding `.lib`.
- `hydra-native.node` is **not** present in the repository. This machine has no
  Rust/MSVC toolchain, so the addon could not be built or load-tested here.

## 7. Migration guardrails

1. Keep `DownloadManager`, status names, seeding flags, and the four RPC
   methods exactly as they are.
2. Keep the native addon and bridge in the Node sidecar; do not reimplement
   libtorrent in Rust for v1.
3. Keep the port and bind semantics. If the Tauri sidecar starts the addon,
   pass the same `5881` default and the same `set_network_interface` behavior.
4. Preserve request timeout defaults and the selective-start 60 s timeout.
5. Preserve `before-quit` cleanup: pause active download, release the lock,
   shut down the torrent service, clear playtime, and stop emulator capture.
6. Do not add a webview-reachable control endpoint for torrents.

## 8. Verification still required

- [ ] Build/load `hydra-native.node` on Windows with the required MSVC/Rust
      toolchain, or obtain a trusted prebuilt addon.
- [ ] Run a real magnet download, pause/resume, selective download, completion,
      and seeding cycle against the baseline.
- [ ] Confirm the effective listen socket with `Get-NetTCPConnection -LocalPort
      5881` and with a configured interface.
- [ ] Confirm shutdown does not leave a listening socket or child process.
- [ ] Record results in `docs/MIGRATION_LOG.md` before claiming Fase 0
      torrent verification.
