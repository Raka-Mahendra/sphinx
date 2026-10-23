# Cloud Save Audit — Hydra 4.1.6 baseline

Baseline commit: `be492f5e3fc4a37c55d7df2b07faf5f9565c84dd`.
Audit date: 2026-10-23.
Scope: both baseline cloud-save pipelines, their remote dependencies, native
restore boundary, IPC/UI surface, and the Google Drive gap. No application code
was changed by this audit.

## 1. Executive summary

The baseline has **two Hydra-backed cloud-save pipelines**, not one:

1. **Legacy `CloudSync`** — Ludusavi backup, tar archive, Hydra
   `/profile/games/artifacts`, presigned S3 upload/download.
2. **v2 snapshots** — native content-addressed snapshot, Hydra
   `/profile/cloud-saves/*`, presigned S3 blob upload/download, immutable
   manifest, versioned restore.

Both are subscription-gated Hydra cloud services. There is **no Google Drive
provider** in the baseline:

- zero references to `GoogleDriveProvider`, `drive.appdata`, Google OAuth,
  PKCE, loopback, or `googleapis`;
- no Google client ID/secret configuration;
- no Drive file naming, quota, or conflict model.

The PRD's Google Drive requirement therefore cannot be implemented by changing
a single URL. It needs a provider boundary around the existing v2 snapshot
engine, while the Hydra backend is disabled.

## 2. Legacy pipeline

| Step | Behavior | Evidence |
| --- | --- | --- |
| Gate | Logged-in user with non-expired `subscription.expiresAt` | `src/main/services/cloud-sync.ts:92-101` |
| Local backup | Ludusavi backs up game files to `backupsPath/<shop>-<objectId>` | `cloud-sync.ts:54-70` |
| Archive | Tar created at `backupsPath/<uuid>.tar` | `cloud-sync.ts:72-83` |
| Prepare | `POST /profile/games/artifacts` with size, shop, objectId, hostname, wine prefix, platform, label | `cloud-sync.ts:122-136` |
| Upload | `axios.put(uploadUrl, fileBuffer)` with `application/tar` | `cloud-sync.ts:138-147` |
| Cleanup | Tar deleted after upload | `cloud-sync.ts:155-162` |

The artifact endpoint returns a presigned S3 URL. There is no chunking,
content-addressed dedupe, or native blob transfer in this path.

## 3. v2 snapshot pipeline

### 3.1 Upload

1. `assertCloudSaveV2Eligible(objectId, shop)`
   (`create-remote-snapshot-from-local-state.ts:109-114`).
2. Build a local snapshot with native hashing and path rules
   (`build-local-game-snapshot.ts`).
3. Enforce upload limits before any network call
   (`upload-limits.ts:3-4`):
   - max **500 files** per snapshot;
   - max **2,147,483,647 bytes** total.
4. `POST /profile/cloud-saves/prepare-snapshot` with shop, objectId, platform,
   hostname, snapshot hash, base version, variants, and files
   (`upload-local-game-snapshot.ts:60-83`).
5. The server returns per-file `upload` or `skip` plus a presigned URL and
   required S3 headers. New blobs are uploaded by the native addon with
   `Content-Length` and `x-amz-checksum-sha256`
   (`upload-local-game-snapshot.ts:145-156`).
6. Upload concurrency is **8** (`upload-local-game-snapshot.ts:20-21`).
7. `POST /profile/cloud-saves/commit-snapshot` commits the pending snapshot;
   transport failure is retried once
   (`create-remote-snapshot-from-local-state.ts:84-101`).
8. A committed snapshot response is validated against the requested hash and
   expected snapshot ID before being accepted
   (`create-remote-snapshot-from-local-state.ts:159-181`).

### 3.2 Restore

1. `GET /profile/cloud-saves/snapshots` lists versions
   (`list-remote-game-snapshots.ts:14-22`).
2. `GET /profile/cloud-saves/snapshot-restore-manifest` returns the immutable
   manifest; it must match the snapshot summary's id, version, file count,
   total size, and aggregate hash (`resolve-remote-snapshot-targets.ts:39-63`).
3. `GET /profile/cloud-saves/snapshot-download-urls` returns presigned blob
   URLs (`download-remote-snapshot-to-temp.ts:25-31`).
4. Blobs are downloaded to
   `tempRoot/hydra-cloud-saves/<snapshotId>/<hash>.blob`; a `.part` file is
   written, flushed, synced, and atomically renamed
   (`native/hydra-native/src/cloud_save/restore/download_blob.rs:12-20,
   34-101`).
5. Size is checked against `Content-Length` and the expected byte count during
   download (`download_blob.rs:45-88`).
6. SHA-256 is verified after download by the native addon
   (`restore-remote-snapshot.ts:71-108`;
   `native/hydra-native/src/cloud_save/restore/verify_file.rs:10-22`).
7. Restore retries once if the remote snapshot changed between planning and
   apply; a second change throws `cloud_save_restore_snapshot_changed_twice`
   (`restore-remote-snapshot.ts:291-312`).
8. Temp blobs are cleaned in `finally`
   (`restore-remote-snapshot.ts:425-432`).

### 3.3 Data contract

`SnapshotFile` is a content-addressed record with `variantId`, `rawPath`,
`relativePath`, SHA-256 `hash`, `sizeBytes`, `lastModifiedAt`, and optional
emulator `stateMetadata` (`cloud-save-contract.ts:124-158`). Variants support
default, Steam account, and opaque folder identities
(`cloud-save-contract.ts:67-101`).

Restore concurrency is **8** (`map-with-concurrency.ts:1`); native hashing
concurrency is **8** (`native/hydra-native/src/cloud_save/hashing/batch.rs:17`).
Do not change these while replacing the remote provider.

### 3.4 Remote endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/profile/cloud-saves/prepare-snapshot` | Reserve blob uploads / skip existing |
| `POST` | `/profile/cloud-saves/commit-snapshot` | Commit pending snapshot |
| `GET` | `/profile/cloud-saves/snapshots` | List versions |
| `GET` | `/profile/cloud-saves/snapshot-restore-manifest` | Fetch immutable manifest |
| `GET` | `/profile/cloud-saves/snapshot-download-urls` | Presigned download URLs |
| `DELETE` | `/profile/cloud-saves/snapshots?...` | Delete all versions for a game |
| legacy `POST` | `/profile/games/artifacts` | Legacy tar upload |

All v2 calls pass `{ needsAuth: true, needsSubscription: true }`; the legacy
path checks subscription manually. There is no anonymous cloud save.

## 4. IPC and UI surface

- `src/main/events/cloud-save/index.ts` imports 25 modules and registers **30**
  IPC channels.
- Examples: `getCloudSaveOverview`, `getCloudSaveV2FileDetails`,
  `syncGameCloudSave`, `syncGameCloudSaveFromModal`,
  `syncCloudSaveOnGamePage`, `resolveCloudSaveConflict`,
  `deleteGameCloudSaveData`, `uploadSaveGame`, custom-path selection, emulator
  destination selection, RetroArch battery selection, and artifact
  export/cancel.
- The module is activated from `src/main/events/index.ts` (`import
  "./cloud-save"`).
- Renderer state and modals live under `src/renderer/src/context/cloud-sync`
  and the existing game-page cloud-save UI.

The 30 channels include both legacy and v2 operations. They cannot all be
deleted when `HYDRA_CLOUD_LEGACY=false`, because the Google Drive replacement
is expected to reuse the same UI and most of the local planning/restore logic.
Disable the Hydra **backend**, not the whole cloud-save feature.

## 5. Google Drive gap

The PRD requires a `GoogleDriveProvider` with content-addressed blobs and
immutable manifests in `appDataFolder`, using only
`https://www.googleapis.com/auth/drive.appdata` (`PRD.md:74, 237-249, 271`).
The baseline provides none of that.

Required new pieces:

| Piece | Why |
| --- | --- |
| Google OAuth desktop flow | No Google login exists; PRD requires system browser + PKCE/loopback |
| Token storage | New refresh token; must use OS-protected storage, not LevelDB plaintext |
| Drive HTTP client | `appDataFolder` list/create/update/delete; quota and 401/403/429 handling |
| Blob naming | SHA-256 keyed filenames; dedupe per user, not global |
| Manifest files | Immutable JSON per snapshot; version pointer/conflict model |
| Provider adapter | Keep v2 snapshot/restore planner, swap Hydra prepare/commit/S3 for Drive |
| Offline/queue behavior | Drive is user-owned and can be unavailable; Hydra retry policy is not sufficient |
| GC | PRD retention: 3 versions/game (1-10), 24-hour grace, 100 MB confirmation |

Critical semantic difference: Hydra's prepare/commit gives the server a
transaction and an authoritative version. Google Drive `appDataFolder` does not
provide the same compare-and-swap API for a multi-file snapshot. The new
provider needs a client-side conflict protocol using the immutable manifest and
Drive file revisions/IDs. Reusing `expectedSnapshotId` and `baseVersion`
unchanged would give a false sense of atomicity.

### Recommended boundary

Keep these local pieces unchanged:

- native snapshot builder and hashing;
- restore planning, path validation, temp blob verification;
- custom paths, emulator providers, RetroArch/RPCS3 logic;
- 30 IPC channels and the existing UI shape.

Replace only the remote layer with an interface such as:

```
listSnapshots(game) -> SnapshotSummary[]
prepareUpload(game, manifest, files) -> { upload: BlobTarget[], skip: string[] }
uploadBlob(target, file)
commitSnapshot(pending) -> SnapshotSummary
getManifest(snapshot) -> Manifest
getDownloadUrls(snapshot, files) -> { file, url }[]
deleteSnapshots(game)
```

Provide two implementations:

- `HydraCloudProvider` — current code, only reachable when
  `HYDRA_CLOUD_LEGACY=true`;
- `GoogleDriveProvider` — new code, selected when configured.

If Google credentials are absent, the UI must show "Google Drive belum
dikonfigurasi di build ini" and must not fall back to Hydra. That matches the
PRD's local-build behavior.

## 6. Flag behavior

`HYDRA_CLOUD_LEGACY` must do all of the following:

- prevent construction/startup of the Hydra cloud provider;
- prevent every `/profile/cloud-saves/*` and `/profile/games/artifacts` call;
- prevent Hydra subscription checks from running for cloud-save operations;
- leave LevelDB ledger/data intact (`PRD.md:175, 369`);
- not hide the Google Drive UI when the Drive provider is configured;
- return `feature_unavailable` only for direct legacy-only calls, not for the
  new Drive operations.

Do not add a sixth flag for this. The existing five-flag budget is explicit
(`PRD.md:168`). Provider selection can be internal configuration; the legacy
flag remains the Hydra off-switch.

## 7. Migration risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Gating only `CloudSync` | v2 still calls Hydra | Gate the provider, not one file |
| Deleting 30 IPC channels | Drive UI loses its transport | Keep channels; replace backend |
| Reusing Hydra version semantics | Drive writes can overwrite concurrent snapshots | Design manifest/revision conflict handling |
| Storing Google refresh token in LevelDB | Credential theft | OS keychain/secret store |
| Drive scope creep | Violates PRD and consent screen | Enforce exactly `drive.appdata` |
| No quota handling | Sync fails opaquely | `about.get`, 403/quota errors, user-visible state |
| Losing local-only behavior | Cloud save unusable without Google | Clear disabled/not-configured state |
| Native temp cleanup | Orphaned blobs | Keep `finally` cleanup and test crash recovery |

## 8. Verification required

- [ ] Build with `HYDRA_CLOUD_LEGACY=false` and no Google credentials; confirm
      zero Hydra cloud-save calls and a clear disabled UI.
- [ ] Build with a test Google client; verify only `drive.appdata` is requested.
- [ ] Upload, list, restore, delete, and conflict paths against Drive.
- [ ] Re-run v2 hash/size/path validation tests against downloaded Drive blobs.
- [ ] Confirm 500-file and 2 GiB limits, concurrency 8, and 3-version GC.
- [ ] Confirm legacy LevelDB data loads but is never uploaded.
- [ ] Record results in `docs/MIGRATION_LOG.md` before claiming Fase 0 cloud
      save verification.

## 9. Open decisions

1. Does the first Sphinx release ship the Drive provider, or ship with cloud
   save disabled until the Google client is configured? The PRD permits the
   latter for local builds but still requires the feature for release.
2. Which local keychain API will hold the refresh token on Windows/Linux?
   Electron `safeStorage` is unavailable after the shell migration; a Tauri
   secret-store plugin or OS credential API is needed.
3. Can the 30-channel IPC contract stay byte-compatible while the backend
   changes? The current UI expects Hydra-shaped snapshot summaries; the Drive
   provider must preserve that shape or add an explicit mapping layer.
4. How will Drive conflicts be represented in the existing
   `resolveCloudSaveConflict` UI? The baseline conflict model assumes a Hydra
   server version, not a Drive revision.
