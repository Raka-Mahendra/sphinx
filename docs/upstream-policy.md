# Upstream policy

Sphinx Launcher is a fork of [hydralauncher/hydra](https://github.com/hydralauncher/hydra).
This file says what that means in practice, so a future contributor does not have
to guess — and so the question "is this still a fork?" has a written answer.

The fork point is the `baseline-hydra` tag (Hydra 4.1.6 content, commit
`be492f5e3fc4a37c55d7df2b07faf5f9565c84dd`). **There is no recurring merge.**
Upstream is a reference and a source of individual fixes, not a branch to pull.

## What is inherited

- **Code.** The baseline was cloned with full history, so every file carries its
  upstream provenance in `git log`. Apache-2.0, as upstream.
- **Licence and notices.** `LICENSE`, `NOTICE`, `LICENSES/`, and
  `native/torrent-bridge/prebuilt/*/THIRD_PARTY_NOTICES.txt` are kept verbatim.
  Any file copied from upstream keeps its copyright header.
- **Dependencies.** Unchanged unless a phase says otherwise.

## What is not inherited

- **Branding.** Name, icon, palette, and the word "Hydra" in user-visible text
  are replaced (fase 2). The `hydra-*` identifiers that remain are listed in
  `docs/branding-allowlist.md` with a reason each — most are LevelDB keys and
  native-module names, where a rename would break data and binaries for no gain.
- **Remote endpoints.** The baseline loaded its renderer from
  `MAIN_VITE_LAUNCHER_SUBDOMAIN` at runtime. That is gone (fase 4): Sphinx always
  loads its own bundle.
- **Account backend.** Everything that needed a Hydra account is hidden behind
  feature flags (PRD §4.B); the flags default to off.
- **Updater.** `electron-updater` pointing at `hydralauncher/hydra` is replaced by
  `tauri-plugin-updater` pointing at this repository (fase 5,
  `docs/release.md`).
- **Electron.** The Electron entry point, builder config, workflows and
  dependencies are deleted (fase 8). Upstream commits that only touch
  `src/main/index.ts`, `electron-builder.yml`, `electron.vite.config.ts`, the
  Electron release workflows, Sentry/analytics wiring or the login UI are
  therefore **not applicable**.

## Take or reject

Judge each upstream commit by what it changes, not by its title.

| Area                                                                         | Take                                                          | Reject                                                                |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| Native torrent engine (`native/hydra-native`, `native/torrent-bridge`)       | Security, crash, resume/seeding, protocol compatibility fixes | Renames of the crates/folders, API rewrites of the bridge             |
| Download pipeline (`src/main/services/download/**`, `DownloadManager`)       | Correctness, resume, file-selection, cleanup fixes            | Changes that assume the Electron main process or a different engine   |
| Catalogue / assets / download sources                                        | API-shape fixes, error handling, new anonymous endpoints      | Endpoints that require a Hydra account or subscription                |
| Data format / LevelDB                                                        | Migration helpers, corruption recovery, key compatibility     | Bulk key renames (they would orphan user data)                        |
| Cloud save                                                                   | Snapshot pipeline correctness, hashing, restore edge cases    | Hydra Cloud/S3/subscription paths; those are replaced by Google Drive |
| UI bugs in surfaces we keep                                                  | Rendering, accessibility, i18n fixes                          | Redesigns, new features, mass reformatting, file moves                |
| Electron shell, updater, Sentry, analytics, WorkWonders, login, Epic runtime | Nothing                                                       | Everything; the code path does not exist here                         |
| Build/release                                                                | Dependency security bumps that apply to our tree              | electron-builder/electron-vite config, Electron workflows             |

If a commit mixes both, take it with `git cherry-pick -x` and revert the
rejected hunks in the same local commit, or copy the accepted hunks by hand.
Never merge upstream.

## Procedure

```sh
git fetch upstream --tags
git log --oneline baseline-hydra..upstream/main        # candidate fixes
git show <upstream-sha>                                # classify every hunk
git cherry-pick -x <upstream-sha>                      # -x records the source SHA
```

`-x` appends `(cherry picked from commit <sha>)` to the message. Keep that line:
it is the only durable link back to upstream once branches diverge.

If the pick conflicts because a phase already changed the same code, resolve in
favour of the phase, then re-run the checks that own the area. If the whole
commit belongs to a deleted code path, abort the pick and record it as rejected
— do not force it in.

After every pick:

1. `yarn gen:ipc-allowlist` when `src/main` changed (the allowlist and
   `docs/ipc-inventory.md` are generated from that source, and
   `src/sidecar/allowlist.test.ts` fails on drift).
2. `yarn typecheck`, `yarn lint`, `yarn format-check`, and the focused tests for
   the area. `yarn test` for anything touching the sidecar or shared code.
3. `yarn build:renderer` for renderer changes; `cargo check` in `src-tauri` for
   shell changes.
4. Add a row to the table below in the same commit.

## Cherry-pick log

One row per upstream commit. Date is when it landed here, not upstream's date.
"Local" is the commit created by the pick.

| Date | Upstream commit | Area | Why taken / rejected                                             | Local commit | Checks |
| ---- | --------------- | ---- | ---------------------------------------------------------------- | ------------ | ------ |
| —    | —               | —    | No upstream cherry-picks have been taken since `baseline-hydra`. | —            | —      |

## What we owe upstream

Bug fixes in the parts that were not forked away (the torrent engine, the
cloud-save pipeline, anything in `native/`) are worth sending upstream. Nothing
in this repository requires that, but it is the reason to keep the fork's diff
small enough to see.

## Trademark

The name "Sphinx" has not been cleared. `docs/MIGRATION_LOG.md` (fase 2) records
this as an open item; it should be checked before a public release.
