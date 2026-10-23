# Feature Flags — Sphinx Launcher (Fase 1)

Baseline commit: `be492f5e3fc4a37c55d7df2b07faf5f9565c84dd`.
Implementation branch: `sphinx/tauri-migration`.
Scope: the runtime feature-flag layer required by `PRD.md` v2.2 §4.B, plus the
parts of §4.E (Electron updater) and §4.G (Epic runtime assets) that interact
with flag-gated code.

This document describes what the flags are, where their values live, how the
main process, both renderers, and the sidecar read them, and how a disabled
feature fails closed. It is the acceptance reference for "run the app
anonymously with every flag off".

## 1. Purpose and rules

Sphinx keeps the Hydra account, cloud, achievement, Steam, and Epic feature
code in the tree during the migration, but every one of those features must be
inert while its flag is `false`. The rules are:

- A disabled feature must not make an outbound account/cloud request.
- A disabled feature must not start a background worker (SSE, sync, watcher).
- Every UI entry point for a disabled feature must be hidden in the desktop
  renderer **and** Big Picture.
- A direct IPC call to a disabled feature must fail closed with a machine
  readable `feature_unavailable` code and a debug-level log line. It must never
  reach the feature implementation.
- LevelDB data (including account/achievement/cloud records) is never deleted by
  a flag. Turning a flag off hides a feature; it does not destroy data.
- Feature code is not deleted in Fase 1. It stays reachable when its flag is
  flipped back on, so the Fase 2 Tauri port has a reference implementation.

Login, token storage, Sentry, and `workwonders-sdk` are **removed**, not
flagged. They are out of scope for this document; see
`docs/account-dependent-features.md` §5 and §6.

## 2. Flag catalog

All values live in `src/shared/feature-flags.json`. The PRD caps the set at
about six parent/child flags; Fase 1 ships five, all `false`:

| Flag                     | Gates                                                                                                 | Default |
| ------------------------ | ----------------------------------------------------------------------------------------------------- | ------- |
| `HYDRA_ACCOUNT_FEATURES` | Hydra login/session, profile, friends, chat, reviews, collections, library sync, download-source sync | `false` |
| `ACHIEVEMENTS`           | Achievements, souvenir sync, achievement watcher/overlay, RetroAchievements connection                | `false` |
| `STEAM_INTEGRATION`      | Steam OAuth, Steam sync, Steam library watcher, Steam session/achievements                            | `false` |
| `EPIC_INTEGRATION`       | Epic auth, Legendary runtime, Epic library/download/cloud sync                                        | `false` |
| `HYDRA_CLOUD_LEGACY`     | Hydra API/S3 cloud saves: legacy tar artifacts **and** v2 snapshots                                   | `false` |

```json
{
  "HYDRA_ACCOUNT_FEATURES": false,
  "ACHIEVEMENTS": false,
  "STEAM_INTEGRATION": false,
  "EPIC_INTEGRATION": false,
  "HYDRA_CLOUD_LEGACY": false
}
```

`HYDRA_ACCOUNT_FEATURES` is the parent flag for the account slice. The other
four are children that can be reasoned about independently. Only
`HYDRA_ACCOUNT_FEATURES` is currently enforced as a parent: chat/friends module
loading and the account stubs key off it directly.

Keeping `epic` as a `shop` value in types and local library records is
deliberate (`PRD.md` §177). `Downloader.Epic = 15` and the Epic store enum stay
so previously imported local data remains readable while
`EPIC_INTEGRATION=false`.

## 3. Sources of truth and readers

| Surface          | File                                                           | Public API                                                                                                                                     |
| ---------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Values           | `src/shared/feature-flags.json`                                | raw booleans                                                                                                                                   |
| Shared loader    | `src/shared/feature-flags.ts`                                  | `featureFlags`, `isFeatureEnabled`, `assertFeatureEnabled`, `FeatureUnavailableError`, `isFeatureUnavailableError`, `FEATURE_UNAVAILABLE_CODE` |
| Main             | `src/main/feature-flags.ts` + `src/main/feature-flags-core.ts` | `requireFeature`, `requireFeatureChannel`, `featureForChannel`, plus re-exports                                                                |
| Desktop renderer | `src/renderer/src/feature-flags.ts`                            | `featureFlags`, `isFeatureEnabled`, `useFeatureFlag`                                                                                           |
| Big Picture      | `src/big-picture/src/feature-flags.ts`                         | `featureFlags`, `isFeatureEnabled`, `useFeatureFlag`                                                                                           |

`src/shared/feature-flags.ts` freezes a copy of the JSON
(`Object.freeze({ ...rawFeatureFlags })`), so runtime code cannot flip a flag.
Values are static per build; there is no settings UI to change them.

The JSON import uses an import attribute so both the bundler and the Node ESM
test runner load it:

```ts
import rawFeatureFlags from "./feature-flags.json" with { type: "json" };
```

The renderer and Big Picture readers import from `@shared`, so both surfaces
always agree with the main process on the same build.

## 4. Main-process enforcement

### 4.1 Channel map (`feature-flags-core.ts`)

`src/main/feature-flags-core.ts` is a pure module (no Electron import) that maps
each gated IPC channel name to its owning flag and exposes:

- `featureForChannel(channel)` → the owning `FeatureFlag` or `undefined`
- `requireFeature(flag)` → throws `FeatureUnavailableError` when off
- `requireFeatureChannel(channel)` → looks up and enforces the channel's flag
- `gatedChannels()` → the frozen list of gated channel names

Channel counts per flag (108 gated channels total):

| Flag                     | Gated channels |
| ------------------------ | -------------: |
| `HYDRA_ACCOUNT_FEATURES` |             28 |
| `ACHIEVEMENTS`           |             20 |
| `STEAM_INTEGRATION`      |              7 |
| `EPIC_INTEGRATION`       |             16 |
| `HYDRA_CLOUD_LEGACY`     |             37 |

`src/main/feature-flags.ts` keeps the logger and public API and delegates to the
core. Its `requireFeature` logs
`[feature-flags] <FLAG> is disabled; rejecting request` at debug level before
throwing, so an operator can see which flag rejected a call without a crash.

### 4.2 Enforcement in `registerEvent`

Every handler registered through `registerEvent`
(`src/main/events/register-event.ts`) calls `requireFeatureChannel(name)` before
invoking its listener:

```ts
ipcMain.handle(name, async (event, ...args) => {
  requireFeatureChannel(name);
  return Promise.resolve(listener(event, ...args)).then(...);
});
```

Channels that are not in the map are unaffected. A gated channel never runs its
listener while the flag is off; the renderer receives a rejected invoke.

### 4.3 Fail-closed account stubs

Chat and friends handlers are not registered through the always-loaded event
graph; their modules are imported only when the account flag is on
(`src/main/main.ts`):

```ts
if (accountFeaturesEnabled) {
  await import("./events/chat");
  await import("./events/friends");
} else {
  await import("./events/register-disabled-account-events");
}
```

`register-disabled-account-events.ts` registers fail-closed stubs for the 18
chat/friends channels so callers get a consistent `feature_unavailable` error
instead of a missing-handler error.

### 4.4 Anonymous `HydraApi` client

`src/main/services/hydra-api.ts` no longer performs authenticated or
subscription requests. `validatePublicRequest` throws
`FeatureUnavailableError("HYDRA_ACCOUNT_FEATURES")` unless the caller passes
`needsAuth: false` (and no subscription). Auth-surface methods
(`handleExternalAuth`, `refreshToken`) throw the same error.
`getAuthContext()` returns `null`, `isLoggedIn()` returns `false`, and
`hasActiveSubscription()` returns `false`, so no token is read or sent.

### 4.5 Renderer-controlled proxy allowlist

`src/main/events/misc/hydra-api-call.ts` is the renderer-facing `hydraApiCall`
channel. It rejects any request that is not an explicit public call:

- `needsSubscription` set → `FeatureUnavailableError("HYDRA_CLOUD_LEGACY")`.
- `needsAuth !== false` or non-allowlisted path →
  `FeatureUnavailableError("HYDRA_ACCOUNT_FEATURES")`.
- Allowed: `GET` on `/catalogue`, `/badges`, `/features`, `/users`, `/games`
  (exact or with a trailing path), and `POST /catalogue/search`.

Everything else fails closed. This preserves anonymous catalogue browsing
without keeping a generic authenticated proxy.

### 4.6 Service and worker startup

`src/main/main.ts` and `src/main/index.ts` gate background work on the flags:

| Work                                                                                    | Guard                    |
| --------------------------------------------------------------------------------------- | ------------------------ |
| Legacy achievement persistence cleanup                                                  | `ACHIEVEMENTS`           |
| Steam library watcher (`watchSteamLibraries`)                                           | `STEAM_INTEGRATION`      |
| Epic integration init (`initializeEpicIntegration`)                                     | `EPIC_INTEGRATION`       |
| Epic playtime suspend/resume handlers                                                   | `EPIC_INTEGRATION`       |
| `uploadGamesBatch`, download-source sync, `DownloadSourcesChecker`, `SSEClient.connect` | `HYDRA_ACCOUNT_FEATURES` |
| Souvenir worker (`groupedSouvenirWorker.trigger`)                                       | `ACHIEVEMENTS`           |
| Steam startup sync                                                                      | `STEAM_INTEGRATION`      |
| Epic startup sync                                                                       | `EPIC_INTEGRATION`       |
| SSE reconnect on system resume                                                          | `HYDRA_ACCOUNT_FEATURES` |
| Achievement watcher in `process-watcher.ts`                                             | `ACHIEVEMENTS`           |
| Achievement loop in `main-loop.ts`                                                      | `ACHIEVEMENTS`           |

When every flag is `false`, no account, cloud, achievement, Steam, or Epic
worker starts.

### 4.7 UI gating

Both renderers read the same `@shared` values:

- Desktop renderer: `src/renderer/src/feature-flags.ts`.
- Big Picture: `src/big-picture/src/feature-flags.ts`.

Gated desktop surfaces include account/settings sections, notifications,
sidebar/profile entry points, the chat and friends windows, achievements
sections, the emulation cloud-save panel and custom-path upsell, the
`Downloader.VikingFile` hoster unlock, and the collections loader
(`use-game-collections.ts` returns `[]` when account features are off).

Gated Big Picture surfaces include the profile/account-privacy/cloud-gift pages,
library notification sections, and `CloudGiftNotificationModal` (conditional on
`accountFeaturesEnabled` in `src/big-picture/src/app.tsx`). The Epic managed
UI (`use-epic-managed.ts`) computes its `available` flag from
`EPIC_INTEGRATION`.

Local emulator save management stays visible: only the Hydra-cloud pieces are
gated by `HYDRA_CLOUD_LEGACY`. This keeps local, offline save handling usable
without an account.

### 4.8 Packaging

Epic/Legendary runtime assets are no longer bundled by `electron-builder.yml`.
Unlike the runtime flags, this is a build-time boundary: the installer omits the
Legendary/Python/runtime payload entirely. The Epic service code remains in the
tree behind `EPIC_INTEGRATION`.

## 5. The `feature_unavailable` contract

`FeatureUnavailableError` (`src/shared/feature-flags.ts`) has:

- `name = "FeatureUnavailableError"`
- `message = "feature_unavailable"`
- `code = "feature_unavailable"` (`FEATURE_UNAVAILABLE_CODE`)
- `feature` = the owning `FeatureFlag`

Electron serializes a thrown error across IPC as a plain `Error` whose message
is preserved but whose custom class is lost. Consumers therefore use
`isFeatureUnavailableError(error)`, which accepts either a real
`FeatureUnavailableError` instance or any object whose `code` is
`feature_unavailable`:

```ts
isFeatureUnavailableError({ code: "feature_unavailable" }); // true
```

The preload keeps the code stable on the removed account APIs:

```ts
openAuthWindow: () =>
  Promise.reject(
    Object.assign(new Error("feature_unavailable"), {
      code: "feature_unavailable",
    })
  ),
```

`hydra-api-call.ts` re-throws a `feature_unavailable` error unchanged (it does
not rewrite it into `hydra-api-call-failed`) so the renderer can distinguish a
disabled feature from a network failure.

## 6. Tests

| Test file                             | Covers                                                                                                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/shared/feature-flags.test.ts`    | Flag set matches the document, every value defaults to `false`, the map is frozen, `assertFeatureEnabled` throws, and `isFeatureUnavailableError` recognizes the code across an IPC boundary     |
| `src/main/feature-flags-core.test.ts` | The channel map matches the gated-flag set, every gated channel is rejected while off, unflagged channels pass, and `requireFeature` rejects a disabled flag                                     |
| `src/main/services/hydra-api.test.ts` | No account identity is exposed; default/auth/subscription requests fail closed as `HYDRA_ACCOUNT_FEATURES`; explicit public requests succeed without credentials; auth-surface methods are inert |

The channel-map test derives its expectation from the production map, so adding
a gated channel without a test entry fails the suite.

Renderer/Big Picture unit tests that import a module which reads
`@renderer/feature-flags` or `@main/feature-flags` stub that module. Tests whose
subject is a gated feature stub the flag to `true` to preserve pre-flag
coverage; tests unrelated to that feature stub `false` to match production.

## 7. Verification

Recorded 2026-10-23 on the Fase 1 branch. Run with every flag at its shipped
default (`false`):

- [x] `corepack yarn typecheck` passes (exit 0).
- [x] `corepack yarn lint` passes (0 errors, 78 pre-existing warnings).
- [x] `corepack yarn format-check` passes.
- [x] `src/shared/feature-flags.test.ts`,
      `src/main/feature-flags-core.test.ts`, and
      `src/main/services/hydra-api.test.ts` pass (13 tests).
- [x] App launches anonymously: no login screen, anonymous catalogue browse
      works, and the run log shows no `/auth/*`, `/profile/*`, Sentry,
      WorkWonders, or SSE traffic.
- [x] A renderer call to a gated channel (`getRemoteLibrarySyncState`) rejects
      with `feature_unavailable` and is handled without an unhandled rejection.

Flag `true`/`false` matrix:

- [x] All flags `false`: typecheck, lint, and format-check pass.
- [x] All flags `true`: typecheck and lint pass. The JSON was restored to
      all-`false` afterward (`git status` clean for the file).

### 7.1 Running the Electron app locally

`electron-vite` needs the built Electron binary
(`node_modules/electron/dist`); if it is missing, `yarn dev` fails with
`Error: Electron uninstall` before the app starts. Restore it with
`node node_modules/electron/install.js`.

The baseline main process reads `import.meta.env.MAIN_VITE_API_URL` at import
time (`src/main/constants.ts:15`, `isStaging`). With no `.env`, the app crashes
at load with `Cannot read properties of undefined (reading 'includes')`. `.env`
is git-ignored; copy `.env.example` and set, at minimum,
`MAIN_VITE_API_URL` (empty is enough for a local boot) and
`MAIN_VITE_LAUNCHER_SUBDOMAIN` (empty loads local renderer assets).

The anonymous run also logs two environment-only failures that are unrelated to
the flags: `ludusavi.exe` is absent (Ludusavi binary not built) and
`hydra-native.node` is absent (native addon not built). Both are logged and do
not stop startup.

Then flip every flag in `src/shared/feature-flags.json` to `true`, re-run
typecheck and lint, and restore the file. The flag reads are static, so both
states must compile cleanly; the shipped state is all-`false`.

## 8. Known limitations and open decisions

- Windows-only environment: the full `yarn test` suite is Linux-only in CI
  (`.github/workflows/lint.yml` runs on `ubuntu-latest`). On this machine the
  Epic `launch.test.ts` suite and several cloud-save/retroarch/rpcs3 tests fail
  for environmental reasons (`fs.realpath` casing, `EPERM` symlinks, path
  separators). These are pre-existing and unrelated to the flag layer.
- `hydra-native.node` is unavailable and cannot be compiled here, so native
  torrent/process/cloud-save paths behind the flags cannot be load-tested.
- `HYDRA_CLOUD_LEGACY` disables the Hydra backend, not local save handling. The
  Google Drive replacement is a separate provider boundary; see
  `docs/cloud-save-audit.md`.
- Open: whether RetroAchievements remains reachable when `ACHIEVEMENTS=false`.
  It is currently gated with the achievement slice.
- Open: whether `STEAM_INTEGRATION` and `EPIC_INTEGRATION` should also require
  `HYDRA_ACCOUNT_FEATURES`, or stay independently switchable.
- Open: `src/main/constants.ts` still throws an unclear `TypeError` when
  `MAIN_VITE_API_URL` is unset. `docs/network-calls.md` §13 asks for a clear
  configuration error instead; guard the `isStaging` expression and make the
  missing configuration explicit.
- Open: the `getRemoteLibrarySyncState` startup call is now gated and
  rejection-safe. A full audit that every renderer caller of every gated
  channel handles `feature_unavailable` has not been done; the anonymous
  startup run currently shows none.
