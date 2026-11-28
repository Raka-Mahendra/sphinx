# Release-readiness audit — Sphinx Launcher

- **Date:** 28 November 2026
- **Repository:** `Raka-Mahendra/sphinx`
- **Branch / commit:** `sphinx/main` @ `4492c5fc1916d410f9744a8651e4405248a42bff`
- **Auditor:** automated agent; local edits and a local commit only — nothing was
  pushed, tagged or published.
- **Scope:** updater signing key, Windows build/release workflow, `v0.1.0`
  artifacts, installer payload, updater code path, security and recovery,
  non-publishing CI signing proof, signing-environment hardening.
- **Explicitly out of scope / not performed:** creating tags, publishing
  releases, replacing assets, changing or reading GitHub secrets, pushing the
  new workflow, running the smoke workflow, running a clean-VM install, or
  running the `0.1.0 → next` update end to end.

This document separates **verified** facts (reproducible from the evidence
below) from **asserted** facts (statements that can only be confirmed by the
repository owner or an authenticated CI run). The final sign-off list is in
[§7](#7-sign-off-checklist).

---

## 1. Verdict summary

| Area                                           | Status                       | Basis                                                                                                                                  |
| ---------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Updater key identity and passwordless behavior | **Verified**                 | Signature produced with an empty password, wrong password rejected, `.sig` cryptographically verified against the committed public key |
| `v0.1.0` release integrity                     | **Verified**                 | Installer, `latest.json`, `.sig` and `SHA256SUMS` all match and verify                                                                 |
| Installer payload completeness                 | **Verified**                 | Torrent engine, VC++ runtime, Node runtime, ludusavi, sidecar and resources all present                                                |
| Release workflow correctness (static)          | **Mostly verified**          | Reviewed end to end; a few unproven assumptions listed in [§4](#4-findings)                                                            |
| Release action maintenance                     | **Migrated**                 | `softprops/action-gh-release` v2 is EOL (Node 20); moved to v3 (Node 24), inputs and used code paths unchanged                         |
| Non-publishing CI signing smoke workflow       | **Prepared, not run**        | `.github/workflows/tauri-signing-smoke.yml` exists locally; it needs an authorized push to become runnable                             |
| Updater signature verifier                     | **Verified locally**         | `scripts/verify-updater-signature.mjs` passes the published `v0.1.0` installer and its manifest                                        |
| GitHub Actions secret presence                 | **Unverified**               | No authenticated `gh`/API access; a secret cannot be read back                                                                         |
| Signing environment protection                 | **Prepared, not configured** | Both signing jobs declare `release-signing`; the owner must create it with a required reviewer before any push (docs/release.md §12)   |
| CI-built signed release                        | **Not proven**               | The only release run failed; no CI-signed artifact exists                                                                              |
| Clean-machine install / SmartScreen / SAC      | **Not run**                  | Requires a fresh Windows 10/11 VM or sandbox                                                                                           |
| `0.1.0 → next` updater end to end (issue #2)   | **Not run**                  | Requires a second published release                                                                                                    |
| Authenticode signing                           | **Not configured**           | No certificate; installer is unsigned by design                                                                                        |

**Bottom line:** the signing key and the 0.1.0 artifacts are sound and the
workflow is, as far as static review can tell, correct. The release pipeline is
**not a validated release candidate** until (a) the owner creates the protected
`release-signing` environment and confirms the secret, (b) one signed build
completes in Actions, and (c) the clean-machine and updater tests are run. None of
those three has happened.

---

## 2. Evidence

### 2.1 Repository and CI state

| Check                                                                                                | Result                                                                                                              |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| HEAD                                                                                                 | `4492c5fc1916d410f9744a8651e4405248a42bff` on `sphinx/main`                                                         |
| Working tree                                                                                         | Phase 1 changes preserved; Phase 2 adds a smoke workflow, a verifier and its tests, plus docs (all local, unpushed) |
| `Lint` run [46126094022](https://github.com/Raka-Mahendra/sphinx/actions/runs/46126094022)           | success — `lint`, `rust (ubuntu-latest)`, `rust (windows-latest)`, `js-windows`                                     |
| `Text Integrity` run [46126093930](https://github.com/Raka-Mahendra/sphinx/actions/runs/46126093930) | success                                                                                                             |
| `Tauri Release` run [45978830327](https://github.com/Raka-Mahendra/sphinx/actions/runs/45978830327)  | failure at `Build the bundle`; `Draft the release` and `Publish the release` skipped                                |
| Release run failure annotation                                                                       | `Command "yarn tauri build" failed with exit code 1`                                                                |
| Release run commit                                                                                   | `e4239c55` (tag `v0.1.0`); predates the signing preflight                                                           |
| Lockfiles tracked                                                                                    | `yarn.lock` and `src-tauri/Cargo.lock` both tracked                                                                 |
| CI Node pin                                                                                          | `22.21.0` (exists; LTS _Jod_, released 2025-10-20)                                                                  |

### 2.2 Updater key

The private key is at `%USERPROFILE%\.sphinx-updater\sphinx-updater.key`
(348 bytes) with `sphinx-updater.key.pub` (152 bytes). Its contents were never
printed.

| Check                                                                                         | Result                                                                                                                    |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `plugins.updater.pubkey` vs `sphinx-updater.key.pub`                                          | **exact match**                                                                                                           |
| Public-key ID (reversed byte display)                                                         | `96C5E41CD0651543`                                                                                                        |
| Public-key blob                                                                               | `Ed` (Ed25519), 42-byte blob, 10-byte prefix + 32-byte key                                                                |
| Signing with **no** password variable                                                         | success, exit 0, “assuming an empty password”                                                                             |
| Signing with `TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""` (what GitHub passes for an unset secret) | success, exit 0                                                                                                           |
| Signing with a wrong password                                                                 | fails, exit 1, `Wrong password for that key`                                                                              |
| Signature verification vs committed public key                                                | `signature_ok = true`, `global_signature_ok = true` (Ed25519 over BLAKE2b-512 prehash, as Tauri's `minisign-verify` does) |
| Key file ACL                                                                                  | `SYSTEM`, `Administrators`, `DESKTOP-RQA4FD4\rakamhndra` only                                                             |
| Private key in git or working tree                                                            | not found (the only history hit for the path is the documentation text)                                                   |

> Tauri's CLI has no `verify` subcommand. Verification was done with a local
> Node script using `node:crypto` Ed25519 + BLAKE2b-512, following the algorithm
> in `minisign-verify`. The library also **ignores** the trusted comment's
> `file:` field, which is why renaming the installer (see §3.1) does not break
> verification.

### 2.3 `v0.1.0` release integrity

Assets (from the GitHub API): `latest.json` (723 B), `SHA256SUMS` (180 B),
`sphinx-launcher_0.1.0_x64-setup.exe` (63,244,484 B) and its `.sig` (448 B).

| Check                           | Result                                                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Installer SHA-256               | `380B4706973A4644D8114A4E166E03E985C4A2862116031985A0FD0E1379B751` — matches `SHA256SUMS` **and** the local build |
| `latest.json` SHA-256           | `535AFD4C34960B876DD4DDA410906B8C66FC9F3F4FDC5AABC419A86D4EE08EA4` — matches `SHA256SUMS`                         |
| `.sig` SHA-256                  | `06004BC0008640C00B3475AFEA4F1317E14332172F712B2CBD2CD8C7C46256A1` — identical to the local `.sig`                |
| `latest.json` `signature` field | byte-identical to the `.sig` content (not a path)                                                                 |
| `latest.json` `version`         | `0.1.0`                                                                                                           |
| `latest.json` URL               | `…/releases/download/v0.1.0/sphinx-launcher_0.1.0_x64-setup.exe` — matches the real asset name                    |
| Signature key ID in `.sig`      | `96C5E41CD0651543` (same key)                                                                                     |
| Release state                   | not draft, not prerelease                                                                                         |
| Live `latest.json` endpoint     | HTTP 200, `version = 0.1.0`                                                                                       |
| Live installer URL in manifest  | HTTP 200, `content-length = 63,244,484`                                                                           |

### 2.4 Installer payload

Extracted and inspected with 7-Zip (NSIS 3, LZMA, 9,863 entries).

| Item                                                                                            | Present | Size (bytes)                           |
| ----------------------------------------------------------------------------------------------- | ------- | -------------------------------------- |
| `sphinx-launcher.exe`                                                                           | yes     | 14,466,048                             |
| `node.exe` (externalBin)                                                                        | yes     | 93,915,464                             |
| `ludusavi/ludusavi.exe` + `config.yaml`                                                         | yes     | 29,811,712                             |
| `hydra-native/hydra-native.node`                                                                | yes     | 10,252,800                             |
| `hydra-native/hydra_torrent_bridge.dll`                                                         | yes     | 11,809,280                             |
| VC++ runtime DLLs (`msvcp140*`, `vcruntime140*`, `concrt140`, `vccorlib140`)                    | yes     | —                                      |
| `hydra-native/THIRD_PARTY_NOTICES.txt`, `torrent-dependencies.json`                             | yes     | —                                      |
| `sidecar/index.mjs` + `sidecar/node_modules/**`                                                 | yes     | 9,833 files, 97,168,520 B uncompressed |
| `tray-icon.png`, `tray-icon-dark.png`, `icon.png`, `achievement.wav`, `linux-game-capture.html` | yes     | —                                      |
| `uninstall.exe`                                                                                 | yes     | —                                      |

| Hygiene check                                          | Result                                                                      |
| ------------------------------------------------------ | --------------------------------------------------------------------------- |
| `.env`, `.pdb`, `.key`, `.pem`, credential/token files | none found in the payload                                                   |
| Source map shipped                                     | `sidecar/index.mjs.map` (11,592,431 B)                                      |
| Non-empty secret inlined by the sidecar build          | none (`import.meta.env` object contains only public URLs and empty strings) |

### 2.5 Version and toolchain consistency

| Source                                         | Value                                                |
| ---------------------------------------------- | ---------------------------------------------------- |
| `package.json`                                 | `0.1.0`                                              |
| `src-tauri/Cargo.toml`                         | `0.1.0`                                              |
| `src-tauri/tauri.conf.json`                    | `0.1.0`                                              |
| `node scripts/bump-version.mjs --check v0.1.0` | all three sources agree                              |
| Yarn                                           | `1.22.22` (pinned in `packageManager` + `yarn.lock`) |
| Tauri CLI                                      | `2.12.4`                                             |
| CI Node                                        | `22.21.0`                                            |
| Node inside the published 0.1.0 installer      | **`24.22.1`**                                        |

### 2.6 Phase 2: non-publishing signing proof

A manual workflow and a verifier were added so the owner can prove CI signing
without a tag:

| Item                                        | Evidence                                                                                                                                                                                                                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/tauri-signing-smoke.yml` | `workflow_dispatch`; repository/ref guards (`sphinx/main` only); `environment: release-signing` (required reviewer); Windows runner; `permissions: contents: read`; real `yarn tauri build`; only `TAURI_SIGNING_PRIVATE_KEY`; evidence-only artifact (3-day retention) |
| `scripts/verify-updater-signature.mjs`      | Mirrors `tauri-plugin-updater`: key ID, Ed25519 over the BLAKE2b-512 prehash (legacy raw bytes allowed), global signature over signature + trusted comment, manifest consistency                                                                                        |
| `scripts/verify-updater-signature.test.mjs` | 18 tests: prehashed and legacy paths, tampered file, wrong key, wrong key ID, tampered trusted comment, manifest URL/signature/version mismatch                                                                                                                         |
| Published `v0.1.0` run                      | `ok: true`, `signature_ok: true`, `global_signature_ok: true`, `manifest.ok: true`, key ID `96C5E41CD0651543`                                                                                                                                                           |
| GitHub Actions run                          | **not run** — the workflow is not on GitHub; a push needs owner authorization                                                                                                                                                                                           |

Both signing jobs now run in the `release-signing` GitHub Environment, so a smoke
run _and_ a tag build stop for a required reviewer before any checkout, install,
build or signing step executes. The environment is **not yet created**: the owner
must create and protect it _before_ the workflow is pushed, because a workflow
that references an unknown environment can make GitHub auto-create it with no
protection. See `docs/release.md` §12.

The verifier reads the public key from `src-tauri/tauri.conf.json` by default and
never reads `TAURI_SIGNING_PRIVATE_KEY`. The workflow uploads only five files
(installer, `.sig`, `latest.json`, `SHA256SUMS`, verification JSON) and fails
before uploading if anything else appears in the evidence directory.

---

## 3. Workflow review (`.github/workflows/tauri-release.yml`)

### 3.1 Structure

- Tag-only trigger (`v*`); `permissions: {}` at the top level.
- `build` job: runs in the `release-signing` environment (required reviewer), so
  a tag build waits for approval before any step; `contents: read`; version
  preflight; install deps (`--ignore-scripts`); download ludusavi; build renderer
  - sidecar + `stage:sidecar-deps`; stage Node; build native addon; check torrent
    resources; optional Authenticode config; `tauri-action` build-only; upload
    `nsis/*.exe(.sig)`.
- `draft` job: `contents: write`; no signing secret; rename the installer to
  `sphinx-launcher_<version>_x64-setup.exe`; generate `latest.json` +
  `SHA256SUMS`; create a **draft** release.
- `publish` job: `contents: write`; no signing secret; re-invokes the same
  action (v3) to finalize (un-draft) the release.

The signing secret is scoped to the `build` job only, and that job has no
release permission. The two `contents: write` jobs (`draft`, `publish`) never
receive it, so approval to sign and permission to publish stay separate. A draft
is never visible under `releases/latest`, so the updater cannot see a
half-uploaded release.

### 3.2 Static checks that passed

- Version preflight runs **before** the ~15-minute build.
- The signing preflight fails fast, naming the secret and the doc section.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is now
  `${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || '' }}`, so Tauri always
  receives an explicit empty string for this passwordless key.
- All actions in the two signing workflows are pinned to immutable commit SHAs
  with the version in a trailing comment, matching `torrent-bridge-prebuilt.yml`:
  `actions/checkout@11d5960…` (v4.4.0), `actions/setup-node@49933ea…` (v4.4.0),
  `actions/upload-artifact@ea165f8…` (v4.6.2),
  `actions/download-artifact@d3f86a1…` (v4.3.0),
  `softprops/action-gh-release@8a0cd651…` (v3.0.4) and
  `tauri-apps/tauri-action@1deb371…` (v1.0.0). `dtolnay/rust-toolchain@stable`
  is intentionally **not** pinned: the ref after `@` selects the toolchain, so a
  commit pin would change which toolchain is installed.
- Both signing jobs declare `environment: release-signing`, so the approval gate
  (once the owner creates it) precedes every step; each job keeps its own
  `github.repository` and `github.ref` guards as well.
- The signing secret is only ever passed through step `env:`, never echoed and
  never placed on a command line; `actions/setup-node`'s yarn cache stores
  dependencies, not secrets; the smoke artifact is an explicit five-file
  allowlist with a short retention.
- The draft-job rename handles the space in `Sphinx Launcher_…`, and the
  updater ignores the signature's `file:` field, so the rename is safe.
- `softprops/action-gh-release@v3` keeps the existing release name and body on
  update (`name = input_name || existing.name || tag`;
  `body = input_body || existing.body`) and finalizes the draft. The `publish`
  job therefore does not clobber the notes or name, and it now sets
  `make_latest: true` so `releases/latest/download/latest.json` resolves to the
  new release instead of relying on the API default. v2.6.2 is the final v2
  release, is no longer maintained, and runs on the Node 20 runtime GitHub
  deprecated; v3 runs on Node 24. The input set and the `uploadOrUpdate` /
  `finalizeRelease` code paths this workflow uses are unchanged between the two
  versions. The live publish behaviour is still unvalidated (no authorized
  release has run since the migration).
- `latest.json` embeds the verbatim `.sig` content, and `SHA256SUMS` is
  generated from the renamed files, so names and URLs stay consistent.
- `actions/setup-node` uses `cache: yarn` with a tracked `yarn.lock`;
  `corepack enable` honours the pinned `packageManager`.

### 3.3 Unproven assumptions

1. **The secret is present, in the environment scope.** The preflight checks
   non-emptiness only, and a secret cannot be read back. It also assumes the
   `release-signing` environment already exists and is protected.
2. **`signtool.exe` is on `PATH`.** The Authenticode step calls it without a
   full path. It is skipped while no certificate secret exists, so this has
   never been exercised.
3. **The action pins resolve.** Every action in both signing workflows is now
   pinned to the commit that `v4`/`v3`/`v1` pointed to at audit time
   (`actions/checkout@11d5960…`, `actions/setup-node@49933ea…`,
   `actions/upload-artifact@ea165f8…`, `actions/download-artifact@d3f86a1…`,
   `softprops/action-gh-release@8a0cd651…` v3.0.4,
   `tauri-apps/tauri-action@1deb371…` v1.0.0), following the existing pattern in
   `torrent-bridge-prebuilt.yml`. The pins were resolved through the GitHub API,
   not by a workflow run, so they are verified as _tags_ but not exercised.
4. **`dtolnay/rust-toolchain@stable`** tracks the latest stable Rust rather than
   a repository-pinned version, so a future Rust release can change the build
   without any repository change.
5. **Workflow YAML is only validated at run time.** CI has no `actionlint`
   (or equivalent) job.

---

## 4. Findings

Severity reflects release impact, not exploitability alone.

### Blockers (must be cleared before calling this a release candidate)

| #   | Finding                                       | Why it blocks                                                                                                                                                                    | How to clear                                                                                                                                          |
| --- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | GitHub Actions secret presence is unverified  | If `TAURI_SIGNING_PRIVATE_KEY` is absent, the next tag fails after ~15 min of build. A secret cannot be read back.                                                               | Owner adds the environment secret under `release-signing`, then a green `tauri-signing-smoke.yml` run proves it exists (§11–§12 of `docs/release.md`) |
| B2  | No CI-built signed release has ever succeeded | The only release run failed at `yarn tauri build`; the public 0.1.0 was built locally (`node.exe` 24.22.1 vs CI 22.21.0). The workflow's signing path is unproven.               | Run the signing smoke workflow first; a real authorized tag is still needed to validate draft/publish and produce a production artifact               |
| B3  | Clean-machine install not tested              | SmartScreen and Windows 11 Smart App Control can hard-block an unsigned installer; the PRD makes this a decision gate.                                                           | Run the §8 plan on clean Windows 10 + 11 VMs, Defender at defaults                                                                                    |
| B4  | `0.1.0 → next` update never run (issue #2)    | The updater contract (download, install, sidecar shutdown, resume data) is untested.                                                                                             | Publish a second release and follow `docs/updater-verification.md`                                                                                    |
| B5  | Signing environment not created yet           | Both signing jobs declare `release-signing`. If it is missing when the workflow is pushed, GitHub may auto-create it unprotected, so the approval gate would silently not exist. | Owner creates and protects `release-signing` (§12 of `docs/release.md`) _before_ authorizing the push                                                 |

### Medium

| #   | Finding                                                                     | Impact                                                                                                                                           | Suggestion                                                                                                  |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| M1  | The published 0.1.0 was not built by the pinned toolchain                   | The shipped runtime differs from what CI tests; reproducibility is not established                                                               | Let CI own the next release; record the built runtime in release notes                                      |
| M2  | Installer and binaries are unsigned                                         | SmartScreen warning on download; possible Smart App Control block                                                                                | Documented; buy/configure Authenticode when it becomes a gate (§6 of `docs/release.md`)                     |
| M3  | `sidecar/index.mjs.map` (11.6 MB) and full package sources ship             | Larger installer; exposes source (already open under Apache-2.0)                                                                                 | Exclude `*.map` from `bundle.resources` if size matters                                                     |
| M4  | `stage-sidecar-deps.mjs` copies whole packages                              | `classic-level` ships `binding.cc`, `binding.gyp` and `deps/leveldb` C++ sources, plus prebuilds for every platform; ~97 MB uncompressed sidecar | Copy only runtime files (allowlist)                                                                         |
| M5  | Google OAuth client secret is embedded in `sphinx-launcher.exe`             | Anyone can extract it                                                                                                                            | Inherent to installed-app OAuth; keep scopes minimal and note it in the security docs                       |
| M6  | Signing jobs are SHA-pinned; other workflows still float, Rust is `@stable` | Residual supply-chain drift in non-signing workflows and the Rust toolchain                                                                      | Pin the remaining actions; consider a Rust toolchain file                                                   |
| M7  | No CI YAML linting                                                          | A syntax error is only found on a tag                                                                                                            | Add `actionlint` to `lint.yml`                                                                              |
| M8  | Signing smoke test is prepared but never run                                | Issue #5 cannot be closed without a CI-signed build                                                                                              | Owner authorizes the push, then runs `.github/workflows/tauri-signing-smoke.yml` (§11 of `docs/release.md`) |

### Low

| #   | Finding                                                             | Note                                                                    |
| --- | ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| L1  | `SHA256SUMS` covers the installer and `latest.json`, not the `.sig` | `.sig` is content-addressed by `latest.json`; optional                  |
| L2  | `latest.json` `pub_date` uses runner wall-clock                     | Informational only                                                      |
| L3  | Installer `CompanyName` is empty                                    | `publisher` is set in config; cosmetic                                  |
| L4  | `webviewInstallMode: downloadBootstrapper` needs internet           | Offline clean-machine install fails; expected for NSIS                  |
| L5  | Branch protection could not be verified                             | API needs auth; `sphinx/main` must be protected before a public release |

---

## 5. Security boundaries (as configured)

- **Updater trust anchor:** the Ed25519 public key baked into
  `plugins.updater.pubkey`. Every update is verified against it; there is no
  revocation list.
- **Secret scope:** the signing secret is recommended to live in the
  `release-signing` environment (§12 of `docs/release.md`), and only the two
  signing jobs declare that environment — `tauri-release.yml`'s `build` job and
  `tauri-signing-smoke.yml`'s `sign` job. The `build` job has `contents: read`;
  only `draft`/`publish` can write to releases, and neither receives the key.
- **Webview capabilities:** `src-tauri/capabilities/default.json` grants only
  `core:*` events and the four Sphinx IPC commands — no filesystem, shell or
  dialog permission. The renderer reaches the OS only through the sidecar RPC.
- **Command gating:** `src-tauri/build.rs` lists every shell command in the app
  manifest, so unlisted windows are rejected by Tauri core before the command
  body runs.
- **User data:** lives in `%APPDATA%\com.sphinxlauncher.app` (`app_data_dir`),
  separate from the install directory (`%LOCALAPPDATA%\Sphinx Launcher` in
  `currentUser` mode). Tauri’s NSIS uninstaller offers a _Delete app data_
  checkbox that is **unchecked by default**, and passive updates do not pass
  `/DELETEAPPDATA`, so uninstall/reinstall and updates preserve saves and
  settings — to be confirmed on a clean machine.
- **Known limits:** passwordless key (no second factor); the secret is usable by
  any workflow that receives it; the Google client secret ships in the binary;
  the installer is unsigned.
- **Smoke workflow:** `.github/workflows/tauri-signing-smoke.yml` runs in the
  `release-signing` environment (required reviewer), has `contents: read`,
  creates no tag/release, and uploads only an allowlisted five-file evidence
  directory (3-day retention). It is additionally anchored to `sphinx/main` in
  this repository. The environment is not created yet; that is the owner's next
  action (§12).

Recovery for a lost or compromised key is in `docs/release.md` §10.

---

## 6. What was _not_ done (and why)

- No tag, release, asset, or secret was created, changed or deleted.
- No GitHub Environment was created or changed: the workflows only _declare_
  `release-signing`, and the owner creates and protects it before the push
  (§12 of `docs/release.md`).
- No push: the workflows, verifier and documentation are local commits only, so
  `workflow_dispatch` cannot see the smoke workflow yet.
- No smoke run: it needs the authorized push above.
- No clean-VM install: no Windows Sandbox/VM tooling was available without
  elevation.
- No updater E2E: it needs a second published release.
- No Authenticode: no certificate exists; nothing was stubbed.

---

## 7. Sign-off checklist

Before the next public release, in order:

1. **Owner** creates and protects the `release-signing` environment exactly as in
   `docs/release.md` §12: required reviewer, deployment branches/tags limited to
   branch `sphinx/main` **and** tag pattern `v*` (tags are required or the release
   build would be blocked), administrator bypass disabled where supported,
   prevent self-review once a second reviewer exists. Then add
   `TAURI_SIGNING_PRIVATE_KEY` as an **environment** secret (not repository-wide)
   and do **not** create `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
2. **Owner** confirms a real offline backup exists and verifies _that backup
   file_ — not the original key — by signing a throwaway file with it and
   checking the key ID is `96C5E41CD0651543` (`docs/release.md` §3). A copy that
   has never signed is an unverified copy.
3. **Owner authorizes** pushing the Phase 2/2.1 commit to `sphinx/main` (only
   after step 1), then runs `tauri-signing-smoke.yml`, approves it, and requires
   `signature-verification.json` to show `ok: true`. This proves CI signing and
   closes issue #5.
4. After the smoke run passes, **delete the repository-level**
   `TAURI_SIGNING_PRIVATE_KEY`, leaving only the environment secret.
5. Produce **one** authorized signed release (for example `v0.1.1`) and confirm
   the published `.sig`, `latest.json` and `SHA256SUMS` verify. This is the only
   proof that draft/publish and the v3 action work end to end.
6. Run the `docs/release.md` §8 clean-machine plan on Windows 10 and 11.
7. Publish a second release and run the `0.1.0 → next` update end to end. This
   closes issue #2.
8. Confirm `sphinx/main` is protected against direct pushes and forced history
   rewrites.

Until step 3, CI signing is unproven. Until steps 5–7, the pipeline is **not a
validated release candidate**, regardless of how green the lint pipeline is.
