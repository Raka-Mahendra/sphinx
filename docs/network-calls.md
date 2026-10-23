# Network Calls Audit — Hydra 4.1.6 baseline

Baseline commit: `be492f5e3fc4a37c55d7df2b07faf5f9565c84dd`.
Audit date: 2026-10-23.
Scope: outbound HTTP(S), WebSocket, P2P, build-time downloads, and local
listeners. No application code was changed by this audit.

## 1. Method and limits

- Static scan of `src/`, `scripts/`, `native/`, and `ludusavi/`, excluding
  `node_modules`, tests, generated output, and vendored prebuilts.
- Env-driven endpoints were resolved from `import.meta.env` and the CI
  workflow variables; no secret values are reproduced here.
- Runtime probes were anonymous only. No Hydra token, Google token, Steam
  session, Epic token, or debrid token was used.
- This is an inventory, not a DNS-level capture. A full packet capture on a
  clean Windows VM is still required for release acceptance.

## 2. Build-time configuration

These values are injected at build time, not hardcoded in the repository:

| Variable | Purpose | Evidence |
| --- | --- | --- |
| `MAIN_VITE_API_URL` | Hydra API base URL | `src/main/services/hydra-api.ts:374-376`; `.env.example:1` |
| `MAIN_VITE_AUTH_URL` | Hydra login/auth page base | `src/main/services/window-manager.ts:907`; `.env.example:2` |
| `MAIN_VITE_CHECKOUT_URL` | Subscription checkout opened in the system browser | `src/main/events/misc/open-checkout.ts:28-40` |
| `MAIN_VITE_EXTERNAL_RESOURCES_URL` | Declared for the main process; no baseline call site found | `src/main/vite-env.d.ts:8` |
| `RENDERER_VITE_EXTERNAL_RESOURCES_URL` | Remote `bundle.js` injected into renderer | `src/renderer/src/app.tsx:333-337` |
| `RENDERER_VITE_SENTRY_DSN` | Sentry browser DSN | `src/renderer/src/main.tsx:61-69`; `.github/workflows/build.yml:107` |
| `MAIN_VITE_LAUNCHER_SUBDOMAIN` | Launcher subdomain config | `.env.example:5` |

Observed runtime behavior on 2026-10-23:

- `hydra-api.hydralauncher.gg` and `api.hydralauncher.gg` are **NXDOMAIN**.
- `https://hydra-api-us-east-1.losbroxas.org` responds and serves the anonymous
  catalogue endpoints. This host is not hardcoded in `src/`; it comes from the
  build environment.
- No default API host is committed. A build without `MAIN_VITE_API_URL` would
  have an empty base URL and cannot be treated as a working release build.

## 3. First-party Hydra traffic

| Host / path | When | Data | Notes |
| --- | --- | --- | --- |
| `MAIN_VITE_API_URL` + `/games/*`, `/download-sources/*`, `/decky/*` | Catalogue, details, downloads | Public metadata, object IDs, source URLs | 15 explicit public main-process calls |
| `MAIN_VITE_API_URL` + `/profile/*`, `/auth/*`, `/library/*` | Login/account features | Bearer token, profile, library, friends, chat, achievements | Removed or flagged |
| `MAIN_VITE_API_URL` + `/profile/cloud-saves/*`, `/profile/games/artifacts` | Cloud save | Snapshot manifests, presigned S3 URLs, tar/blobs | Hydra subscription required |
| `MAIN_VITE_API_URL` + `/profile/integrations/epic` | Epic integration | Epic account link/sync data | Epic flag |
| `MAIN_VITE_AUTH_URL` | Login window only | Login page | Removed with account |
| `MAIN_VITE_CHECKOUT_URL` | Subscription checkout | Payment page | Removed with account |
| Realtime WebSocket from `POST /auth/realtime` | Logged-in only | Chat/friends events | URL/token issued by Hydra; not hardcoded |
| `cdn.losbroxas.org` | Favicon, Ludusavi manifest, native manifest | Static assets/manifest | `src/shared/index.ts:348`; `ludusavi/config.yaml:4`; `native/hydra-native/src/cloud_save/manifest/source.rs:1` |
| `workwonders.app` | WorkWonders SDK | Changelog/feedback/knowledge; token if present | CORS allowlist at `window-manager.ts:351-386`; removed with account |
| `https://release-v<version>.<MAIN_VITE_LAUNCHER_SUBDOMAIN>` | Production renderer HTML/JS | The entire app UI, from a remote host | `src/main/services/window-manager.ts:149-162`; trusted as an IPC origin by `events/epic/assert-trusted-sender.ts:22-27` and `events/misc/file-system.ts:21-33` |

Remote renderer branch: when `MAIN_VITE_LAUNCHER_SUBDOMAIN` is set, every
window tries to load `https://release-v<dashed-version>.<subdomain>#/...`
before falling back to the local file. With `sandbox: false` and the app's IPC
allowlist, that makes a remote CDN an executable part of the desktop app and a
trusted IPC origin. This is a release-blocking supply-chain finding for Sphinx:
ship local renderer assets only, or pin integrity and remove the remote origin
from every trust check.

The renderer loads a **remote JavaScript bundle** on startup:

```
const $script = document.createElement("script");
$script.src = `${RENDERER_VITE_EXTERNAL_RESOURCES_URL}/bundle.js?t=${Date.now()}`;
document.head.appendChild($script);
```

Evidence: `src/renderer/src/app.tsx:331-338`. This happens independently of
login and is a code-execution trust boundary. Sphinx must remove it, not merely
flag the resulting UI.

`WorkWonders` is initialized even when no token is present
(`src/renderer/src/app.tsx:187-220, 331`). The SDK is a third-party network and
telemetry dependency; it must be removed with the account features.

The API logger redacts known secret keys and URL query parameters
(`src/main/services/network-log-payload.ts:4-48, 102-137`), but it still logs
request/response metadata. Do not add new secret-bearing fields without
extending that redaction set.

## 4. Catalogue, store, and metadata

| Host | Used for | Evidence |
| --- | --- | --- |
| `store.steampowered.com` | Store search/details | `src/main/services/steam.ts:157`; Steam store session |
| `api.steampowered.com` | Steam Web API | `src/main/services/steam-integration/steam-web-api.ts:14` |
| `steamcommunity.com` | Community achievements/profile | `steam-integration/steam-community-achievements.ts:1`; `steam-store-session.ts:271` |
| `cdn.akamai.steamstatic.com` | Store artwork | game details sidebar; `steam-store-session.ts` |
| `cdn.cloudflare.steamstatic.com` | Profile/achievement images | Big Picture/profile; Steam community |
| `shared.steamstatic.com` | Shared Steam images | library merge/game launcher |
| `steam250.com` | Steam top-250 metadata | `src/main/services/steam-250.ts:8` |
| `archive.org` | Archive.org metadata/download | `src/shared/archive-org.ts:6` |
| `hydrathemes.shop` | Theme catalogue link | `src/renderer/src/constants.ts:33` |
| `hydrawrapped.com` | User-clicked wrapped page | `wrapped-tab.tsx:93` |
| `www.protondb.com` | User-clicked ProtonDB link | `protondb-section.tsx:109` |
| `docs.hydralauncher.gg` | Theme documentation link | `add-theme-modal.tsx:33` |

Most of these are user-visible links or catalogue metadata. Steam store and
community endpoints are account-adjacent where they use a Steam session; they
must be gated with `STEAM_INTEGRATION`.

## 5. Download sources, hosters, and debrid

| Host | Used for | Evidence |
| --- | --- | --- |
| `api.real-debrid.com` | Real-Debrid API | `src/main/services/download/real-debrid.ts:47` |
| `api.alldebrid.com` | AllDebrid API | `src/main/services/download/all-debrid.ts:105, 360-399` |
| `www.premiumize.me` | Premiumize API | `src/main/services/download/premiumize.ts:87` |
| `api.torbox.app` | TorBox API | `src/main/services/download/torbox.ts:25` |
| `api.gofile.io`, `gofile.io`, `gofilecdn.eu.cc` | GoFile hoster | `src/main/services/hosters/gofile.ts:57-62, 339, 396, 671` |
| `pixeldrain.com` | PixelDrain resolver | `src/main/services/hosters/pixeldrain.ts:11` |
| `mediafire.com`, `www.mediafire.com` | MediaFire resolver | `src/main/services/hosters/mediafire.ts:29`; `src/shared/index.ts:165,172` |
| `www.rootz.so` | Rootz resolver | `src/main/services/hosters/rootz.ts:32` |
| `vikingfile.com`, `vik1ngfile.site` | VikingFile resolver | `src/shared/index.ts:178-179` |
| `1fichier.com` | 1fichier resolver | `src/shared/index.ts:165` |
| `datanodes.to`, `fuckingfast.co` | Hoster resolvers | `src/shared/index.ts:171-174` |

These calls happen only when the user has configured a debrid account, selects
a hoster, or starts a download. They still need an explicit allowlist and
per-provider consent. Presigned URLs can point at arbitrary S3/CDN hosts; an
allowlist must be domain-scoped, not path-only.

## 6. Emulation and runtime downloads

| Host | Used for | Evidence |
| --- | --- | --- |
| `dl.dolphin-emu.org`, `flatpak.dolphin-emu.org`, `dolphin-emu.org` | Dolphin | `dolphin-install-source.ts:6,41`; `emulator-install-sources.ts:295` |
| `pcsx2.net` | PCSX2 link | setup download page |
| `rpcs3.net` | RPCS3 link | setup download page |
| `www.duckstation.org` | DuckStation link | setup download page |
| `www.ppsspp.org` | PPSSPP link | setup download page |
| `buildbot.libretro.com` | RetroArch cores | `retroarch-install-sources.ts:8` |
| `flathub.org` | Flatpak installs | `emulator-install-sources.ts:151-269` |
| `aur.archlinux.org` | AUR sources | `emulator-install-sources.ts:87-199` |
| `api.github.com`, `github.com` | GitHub releases and UMU | `emulator-install-sources.ts:363`; `umu-updater.ts:22` |
| `www.playstation.com` | PS firmware link | `ps-firmware-url.ts:10` |
| `retroachievements.org`, `media.retroachievements.org` | RetroAchievements API/images | `retro-achievements-client.ts:26`; settings page |
| `www.retroarch.com` | RetroArch link | setup page |

`RetroAchievements` is an external account integration. It must be gated with
`ACHIEVEMENTS` unless the PRD explicitly separates it.

## 7. Epic / Legendary

| Host | Used for | Evidence |
| --- | --- | --- |
| `www.epicgames.com` | Epic OAuth login | `src/main/services/epic/auth-protocol.ts:55-58` |
| `launcher.store.epicgames.com/graphql` | Epic achievements/store | `epic/constants.ts:8`; `epic-store-details.ts:79` |
| `library-service.live.use1a.on.epicgames.com` | Epic playtime/library | `epic/constants.ts:40` |
| `datastorage-public-service-liveegs.live.use1a.on.epicgames.com` | Epic cloud saves | `epic/constants.ts:48` |
| `github.com/legendary-gl/legendary` | Legendary release | `legendary-manifest.json:3-39` |
| `www.python.org`, `files.pythonhosted.org` | Embedded Python runtime | `legendary-manifest.json:55-70` |
| `deb.debian.org` | Linux runtime packages | `legendary-manifest.json:87-99` |
| `api.github.com/repos/Open-Wine-Components/umu-launcher` | UMU updates (Linux) | `umu-updater.ts:22` |

`prepare-legendary.cjs` downloads these at install/build time. The root
`postinstall` runs it (`package.json:30`), so a seemingly local build can make
Epic-related outbound calls. This must be gated by the Epic build variant.

## 8. Updates and GitHub

- Electron auto-updater feed: `hydralauncher/hydra` GitHub releases
  (`src/main/index.ts:57-61`), checked periodically from
  `src/main/services/main-loop.ts:44`.
- On Windows startup, `CommonRedistManager.downloadCommonRedist()` downloads
  missing redistributables from
  `https://github.com/hydralauncher/hydra-common-redist/raw/refs/heads/main/`
  (`src/main/index.ts:221-223`;
  `src/main/services/common-redist-manager.ts:226-256`). The call has no local
  catch, so an offline failure becomes an unhandled rejection. Sphinx must host
  its own verified redist payload or make this opt-in.
- `api.github.com` is also used by UMU and emulator install sources.
- Sphinx must change the update feed owner/repo and signing identity; leaving
  the Hydra feed would be both a branding and supply-chain defect.

## 9. Telemetry and third-party SDKs

| SDK | When | Destination | Disposition |
| --- | --- | --- | --- |
| `@sentry/react` | Renderer startup, if DSN present | Sentry ingest | Remove |
| `workwonders-sdk` | Renderer startup | `workwonders.app` and vendor endpoints | Remove |
| Electron `crashReporter` | Startup, `uploadToServer: false` | Local crash dumps only | Keep local until shell removal |
| Hydra API logger | Every Hydra request | Local log file | Keep, but redact and scrub |
| Google Drive provider | Not present in baseline | None | New, `drive.appdata` only |

No PostHog, Mixpanel, Amplitude, Segment, GA, Umami, or Plausible integration
was found. `MAIN_VITE_ANALYTICS_API_URL` is declared in
`src/main/vite-env.d.ts:5` but has no call site.

## 10. Torrent and peer-to-peer traffic

- The torrent addon listens on `0.0.0.0:5881` by default; that is the
  BitTorrent listen port, not an HTTP API (`native/torrent-bridge/bridge.cpp:39`;
  `native/hydra-native/src/torrent/validation.rs:110-126`).
- Trackers are read from `native/hydra-native/src/torrent/trackers.json` and
  from user/global tracker settings. Peer, DHT, and tracker traffic is P2P and
  cannot be reduced to a fixed host allowlist.
- Magnet/torrent URLs and download-source HTTP URLs are user-controlled. The
  sidecar must keep the baseline validation and must not proxy arbitrary URLs
  through a privileged endpoint.
- The renderer currently exposes a generic Hydra API proxy
  (`events/misc/hydra-api-call.ts`), but it is relative-path Hydra-only; the
  torrent path is separate.

## 11. Local-only and loopback

| Surface | Behavior | Evidence |
| --- | --- | --- |
| `local:` protocol | Serves local images/files to renderer | `src/main/index.ts:86-181` |
| `gradient:` protocol | Generates SVG gradients | `src/main/index.ts:118-181` |
| Notification links | `localhost` links in notification UI | Big Picture/Renderer notification components |
| Torrent listener | `0.0.0.0:5881` default | torrent bridge |
| Epic auth window | Isolated session, HTTPS-only navigation | `epic/auth-window.ts` |

The `local:` protocol is a local-file read capability exposed to the renderer.
It is not an outbound call, but it is part of the attack surface that must be
preserved or tightened during the Tauri migration.

## 12. Migration requirements

1. Define a network allowlist by origin and purpose. Do not ship a generic
   "any HTTPS" permission.
2. Keep the public catalogue calls; remove every account-only call when its
   flag is false.
3. Remove the remote `bundle.js`, Sentry, and WorkWonders before shipping.
4. Replace the Hydra update feed with the Sphinx repository and a documented
   signing key.
5. Gate `prepare:legendary` and all Epic downloads behind the Epic build
   variant, not just a runtime flag.
6. Keep presigned URL handling domain-scoped; do not allow a renderer-supplied
   host.
7. Document P2P traffic and the `0.0.0.0:5881` listener in the user-facing
   network/privacy note.
8. Run a clean-VM capture for: first launch, anonymous catalogue, one torrent,
   one hoster, one emulator install, update check, and flag-off startup.

## 13. Verification required

- [ ] First launch with no account: record every outbound connection.
- [ ] `HYDRA_ACCOUNT_FEATURES=false`, `ACHIEVEMENTS=false`,
      `STEAM_INTEGRATION=false`, `EPIC_INTEGRATION=false`,
      `HYDRA_CLOUD_LEGACY=false`: confirm no account/cloud/Epic/Steam/Sentry/
      WorkWonders traffic.
- [ ] Confirm the only startup third-party call is the intended update check.
- [ ] Confirm the app works with no `MAIN_VITE_API_URL` for local-only features,
      or fails with a clear configuration error.
- [ ] Record results in `docs/MIGRATION_LOG.md` before claiming Fase 0 network
      verification.
