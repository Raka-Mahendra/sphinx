# Account-Dependent Features Audit — Hydra 4.1.6 baseline

Baseline commit: `be492f5e3fc4a37c55d7df2b07faf5f9565c84dd`.
Audit date: 2026-10-23.
Scope: Hydra account/auth, subscription-gated features, anonymous catalogue
paths, direct renderer API proxies, and the removal/flag boundary required by
`PRD.md` v2.2. No application code was changed by this audit.

## 1. Executive summary

- The baseline has a full Hydra account system: browser-based login, persisted
  access/refresh tokens, subscription state, profile, friends, chat, reviews,
  library sync, download-source sync, achievements, and Hydra-backed cloud
  saves.
- `HydraApi` defaults to **authenticated**. A main-process call without
  `needsAuth: false` throws `UserNotLoggedInError` before any HTTP request.
- The account surface is not isolated in one folder. It is spread across
  `src/main/services`, `src/main/events`, both renderers, and the native cloud
  save code.
- The catalogue still has public endpoints. Removing `HydraApi` wholesale would
  break anonymous browsing and downloads. The migration must **split a public
  catalogue client** from the account client instead of deleting the HTTP path.
- Source counts differ slightly from the PRD's heuristic counts. The exact
  source-derived counts are recorded below and should be used for Fase 1
  verification.

## 2. Auth and token storage

| Item               | Baseline behavior                                                   | Evidence                                                              |
| ------------------ | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Default auth       | `needsAuth` defaults to `true`                                      | `src/main/services/hydra-api.ts:634-640`                              |
| Logged-in test     | Non-empty in-memory access token                                    | `hydra-api.ts:151-153`                                                |
| Token refresh      | Refreshes before expiry, 20 s timeout, queues persistence           | `hydra-api.ts:136-137, 489-557`                                       |
| Subscription test  | `subscription.expiresAt > now`                                      | `hydra-api.ts:155-158`                                                |
| Subscription gate  | Refreshes user, then throws `SubscriptionRequiredError`             | `hydra-api.ts:652-660`                                                |
| Token persistence  | JSON record in LevelDB under `levelKeys.auth`                       | `hydra-api.ts:98-106`; `src/types/level.types.ts:20-23`               |
| Persisted fields   | `accessToken`, `refreshToken`, `tokenExpirationTimestamp`           | `src/types/level.types.ts:20-23`                                      |
| WorkWonders JWT    | Persisted with auth and sent to the renderer                        | `hydra-api.ts:262-268`                                                |
| Encryption at rest | None; no `safeStorage` use in the baseline                          | source scan of `src/main`                                             |
| Login transport    | Browser auth window + custom-protocol callback carrying base64 JSON | `hydra-api.ts:206-245`; `src/main/services/window-manager.ts:884-930` |

The auth tokens are bearer credentials. They are stored as ordinary LevelDB
JSON, not with Electron `safeStorage` or an OS keychain. The migration removes
the account entirely, so this storage must not be carried into Sphinx.

## 3. Public and authenticated call surface

### 3.1 Main-process `HydraApi.*`

A source scan found **109** non-test `HydraApi.<get|post|put|patch|delete>`
call sites in `src/main`. This is narrower than the PRD's 251-site count,
because the renderer and Big Picture also call the API through the preload
proxy.

- **15** main-process call sites explicitly pass `needsAuth: false`.
- **19** main-process call sites require a subscription, directly or through a
  shared options constant. Grouped by feature:

| Group                     | HTTP calls | Evidence                                                      |
| ------------------------- | ---------: | ------------------------------------------------------------- |
| Cloud-save v2             |          7 | `src/main/services/cloud-save/*`                              |
| Emulation cloud saves     |          6 | `src/main/services/emulators/emulation-cloud-saves.ts`        |
| Game artwork cloud        |          4 | `src/main/services/game-artwork-cloud.ts:98-163`              |
| Achievement image presign |          1 | `src/main/services/achievements/achievement-image-service.ts` |
| VikingFile hoster unlock  |          1 | `src/main/services/hosters/vikingfile.ts`                     |
| **Total**                 |     **19** |                                                               |

This corrects the PRD's 17: the source has six emulation calls and four artwork
calls, not five and three. The exact count must be rechecked when the
`HYDRA_CLOUD_LEGACY` flag is wired.

### 3.2 Public main-process calls (15)

| Purpose                   | Endpoint / call                        | Evidence                                                 |
| ------------------------- | -------------------------------------- | -------------------------------------------------------- |
| Game assets               | `GET /games/:shop/:objectId/assets`    | `events/catalogue/get-game-assets.ts`                    |
| Game basic metadata       | `GET /games/:shop/:objectId`           | `events/catalogue/get-game-shop-details.ts`              |
| LaunchBox shop details    | `POST /games/shop-details`             | `events/catalogue/get-game-shop-details.ts`              |
| Epic shop details         | `GET /games/epic/...`                  | `events/catalogue/get-game-shop-details.ts`              |
| Game stats                | `GET /games/:shop/:objectId/stats`     | `events/catalogue/get-game-stats.ts`                     |
| Add download source       | `POST /download-sources`               | `events/download-sources/add-download-source.ts`         |
| Sync download sources     | `POST /download-sources/sync`          | `events/download-sources/sync-download-sources.ts`       |
| Decky release info        | `GET /decky/release`                   | `events/misc/get-hydra-decky-plugin-info.ts`             |
| Queue download            | `POST /games/:shop/:objectId/download` | `events/torrenting/add-game-to-queue.ts:92-97`           |
| Start download            | `POST /games/:shop/:objectId/download` | `events/torrenting/start-game-download.ts:92-97`         |
| Migrate download source   | `POST /download-sources`               | `helpers/migrate-download-sources.ts:15`                 |
| RPCS3 catalogue lookup    | `POST /games/shop-details`             | `services/cloud-save/rpcs3-game-identity.ts:20-27`       |
| LaunchBox metadata        | `POST /games/shop-details`             | `services/emulators/launchbox-shop-details.ts`           |
| RetroAchievements mapping | `GET /games/:shop/:objectId`           | `services/retro-achievements/retro-achievements-sync.ts` |
| RetroArch metadata        | `POST /games/shop-details`             | `services/retroarch/retroarch-shop-details.ts`           |
| Decky service info        | `GET /decky/release`                   | `services/decky-plugin.ts`                               |

Some of these are account-adjacent in product terms (Decky, RetroAchievements)
but their HTTP call is public at the API layer. They are not evidence that the
whole feature is anonymous.

### 3.3 Renderer and Big Picture proxy

The preload exposes a generic `hydraApi` object
(`src/preload/index.ts:1533-1630`). Renderer and Big Picture code use it
directly for **97** non-test calls. Examples:

- catalogue/search/features/similar games
- game reviews and review voting (Big Picture)
- profile badges and friends
- cloud-sync UI
- collection and game-details data

The main handler is `src/main/events/misc/hydra-api-call.ts:17-83`. It accepts
an arbitrary relative `url`, method, body, params, and auth flags. It has no
endpoint allowlist. This is a **renderer-controlled HTTP proxy** inside the
trusted process.

Consequences for migration:

1. Do not keep `hydraApiCall` as a generic proxy after login removal. It would
   preserve account capability and allow arbitrary relative API paths.
2. Introduce explicit public RPCs (catalogue search, details, assets, stats,
   download options, download-source operations) and route only those.
3. Remove the account proxy and all renderer call sites together; a flag alone
   is not enough because the proxy is an account capability.

## 4. Runtime verification of anonymous access

Probes were run on 2026-10-23 against
`https://hydra-api-us-east-1.losbroxas.org` (the documented
`hydra-api.hydralauncher.gg` host is NXDOMAIN). No credentials were sent.

| Endpoint                                     | Result | Interpretation                 |
| -------------------------------------------- | ------ | ------------------------------ |
| `GET /games/steam/620/stats`                 | `200`  | Public catalogue stats         |
| `GET /games/steam/620/assets`                | `200`  | Public assets                  |
| `GET /games/steam/620`                       | `200`  | Public game metadata           |
| `POST /games/shop-details` (valid JSON)      | `200`  | Public metadata                |
| `GET /decky/release`                         | `200`  | Public release info            |
| `POST /download-sources/sync` (`{"ids":[]}`) | `400`  | Public route, validation error |
| `POST /download-sources` (`{}`)              | `400`  | Public route, `url` required   |
| `GET /profile/me`                            | `401`  | Account required               |
| `GET /profile/download-sources`              | `401`  | Account required               |
| `GET /profile/cloud-saves/snapshots?...`     | `401`  | Account required               |
| `POST /auth/realtime`                        | `401`  | Account required               |
| `GET /games/steam/620/artwork/grid`          | `401`  | Artwork endpoint is not public |

Do not infer that every `needsAuth:false` route is anonymous-compatible. The
marketplace artwork route in particular rejects anonymous callers. The
catalogue UI needs a fallback for missing artwork when no account exists.

## 5. Feature classification and flags

PRD v2.2 requires five parent flags in `src/shared/feature-flags.json`:

| Flag                     | Feature slice                                                                        | Baseline entry points                                                                                                                                                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HYDRA_ACCOUNT_FEATURES` | Friends, chat, profile, reviews, library sync, download-source sync                  | `src/main/events/friends`, `events/chat`, `events/profile`, `events/notifications`, `services/friends*`, `services/chat*`, `services/library-sync`, `services/user`; renderer `friends-window`, `chat-window`, `profile`, `notifications`, profile sidebar, reviews in `src/big-picture/src/components/pages/game/game-reviews` |
| `ACHIEVEMENTS`           | Achievements, souvenir, RetroAchievements, achievement watcher/overlay               | `src/main/services/achievements`, `events/user`, `events/notifications`, `renderer/pages/achievements`, achievement overlay, settings sections                                                                                                                                                                                  |
| `STEAM_INTEGRATION`      | Steam login, sync, library watcher, Steam store session, Steam achievements/playtime | `src/main/services/steam-integration`, `events/user` Steam channels, `events/library` Steam paths, Steam settings pages                                                                                                                                                                                                         |
| `EPIC_INTEGRATION`       | Epic auth, Legendary runtime, Epic library/download/cloud sync                       | `src/main/services/epic`, `events/epic`, Epic settings and game-details paths                                                                                                                                                                                                                                                   |
| `HYDRA_CLOUD_LEGACY`     | Hydra API/S3 cloud saves, both legacy tar artifacts and v2 snapshots                 | `src/main/services/cloud-sync.ts`, `src/main/services/cloud-save/*`, `events/cloud-save/*`                                                                                                                                                                                                                                      |

Important corrections:

- Login UI, auth token storage, Sentry, and `workwonders-sdk` are **removed
  entirely**, not flagged (`PRD.md:169, 179-183`).
- `HYDRA_CLOUD_LEGACY` must cover **both** Hydra cloud pipelines. The legacy
  `CloudSync` tar path is not the only Hydra dependency; the v2 snapshot
  pipeline also uses `/profile/cloud-saves/*` and presigned S3 URLs. If the
  flag only disables `CloudSync`, turning it off still leaves v2 calls active.
- The new Google Drive cloud save is not a flag-off replacement inside the old
  pipeline. It needs a provider boundary; see `docs/cloud-save-audit.md`.
- The `epic` value of `shop` stays in types and local library records even when
  Epic integration is off (`PRD.md:177`).

When a flag is `false`, required behavior is:

- hide every renderer and Big Picture entry point;
- do not start the background service (SSE, achievement watcher, sync worker);
- omit related channels from the IPC allowlist;
- return `feature_unavailable` for direct calls and log at debug level;
- keep LevelDB data intact;
- make no outbound calls for that feature.

## 6. Removal hazards

| Hazard                                  | Why it matters                                                           | Required handling                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `HydraApi` imported by public catalogue | Deleting the class breaks anonymous browsing                             | Split public client first; keep only explicit public methods                         |
| `hydraApiCall` generic proxy            | Bypasses any service-level removal                                       | Remove or replace with an allowlisted catalogue RPC                                  |
| Auth deep link branch                   | `handleDeepLinkPath` handles `auth`, `steam-connected`, `update-account` | Keep `run`; remove auth branches and protocol registration tests                     |
| `window-manager.ts` auth windows        | Creates Hydra auth renderer/view                                         | Delete auth window class and login callbacks                                         |
| `SSEClient` on login                    | Realtime chat/friends; `HydraApi.post("/auth/realtime")`                 | Do not start; remove account event handlers                                          |
| `workwondersJwt`                        | Persisted with auth; sent to renderer; SDK calls vendor                  | Remove from auth type and renderer initialization                                    |
| Sentry                                  | Renderer init, tracing, replay                                           | Remove dependency and DSN; keep `crashReporter` local-only until Electron removal    |
| LevelDB auth/user keys                  | Old tokens could remain after upgrade                                    | New Sphinx data directory; if reusing, delete `levelKeys.auth`/`user` and remote IDs |
| Big Picture reviews                     | Public-looking UI calls authenticated endpoints                          | Hide with account flag and remove vote calls                                         |
| Subscription checks                     | Many services silently return when unsubscribed                          | A flag check is not enough; remove or gate the API call itself                       |
| Public artwork route                    | Returns 401 anonymously                                                  | Add fallback; do not surface a login prompt                                          |

## 7. Suggested implementation order (Fase 1, not done here)

1. Add `src/shared/feature-flags.json` and a typed loader used by main,
   renderer, and Big Picture. Default every hidden feature to `false`.
2. Extract a `PublicCatalogueClient` with only the verified public endpoints.
   Move catalogue/search/assets/stats/download-source calls to it.
3. Replace `hydraApiCall` with explicit public RPC channels and update the 97
   renderer calls. Delete the generic proxy.
4. Remove login UI, auth window, auth deep-link branches, token persistence,
   and the login-related preload APIs.
5. Remove Sentry and WorkWonders, including the external `bundle.js` script.
6. Gate the five feature slices at IPC registration, service startup, and UI
   entry points. Return `feature_unavailable` for direct calls.
7. Remove account-only IPC channels from the generated allowlist and add tests
   that flag-false calls cannot reach the main handler.
8. Verify anonymous catalogue, game details, assets, download, and local
   library without any Hydra token or outbound account call.

## 8. Open decisions

- The PRD's 251/16 counts are heuristic. This audit's measured counts are
  109 main calls / 15 explicit public, plus 97 direct renderer calls. Confirm
  which count the Fase 1 acceptance test should use.
- Decide whether the Google Drive replacement reuses the v2 snapshot UI
  immediately or ships behind `HYDRA_CLOUD_LEGACY=false` first.
- Decide whether RetroAchievements remains when `ACHIEVEMENTS=false`. PRD lists
  achievements and souvenir together; RetroAchievements is an external account
  and currently entangled with the same UI.
- Delete `levelKeys.auth`/`user` on first Sphinx run, or rely on the new app
  data directory. The latter is safer but must be documented for users who
  copy an old profile.
