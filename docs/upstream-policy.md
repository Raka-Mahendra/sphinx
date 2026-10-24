# Upstream policy

Sphinx Launcher is a fork of [hydralauncher/hydra](https://github.com/hydralauncher/hydra).
This file says what that means in practice, so a future contributor does not have
to guess — and so the question "is this still a fork?" has a written answer.

## What is inherited

- **Code.** The baseline was cloned with full history (`baseline-hydra`), so
  every file carries its upstream provenance in `git log`. Apache-2.0, as
  upstream.
- **Licence and notices.** `LICENSE`, `NOTICE`, `LICENSES/`,
  `native/hydra-native/THIRD_PARTY_NOTICES.txt` are kept verbatim. Any file
  copied from upstream keeps its copyright header.
- **Dependencies.** Unchanged unless a phase says otherwise.

## What is not inherited

- **Branding.** Name, icon, palette, and the word "Hydra" in user-visible text
  are replaced (Fase 2). The `hydra-*` identifiers that remain are listed in
  `docs/branding-allowlist.md` with a reason each — most are LevelDB keys and
  native-module names, where a rename would break data and binaries for no gain.
- **Remote endpoints.** The baseline loaded its renderer from
  `MAIN_VITE_LAUNCHER_SUBDOMAIN` at runtime. That is gone (Fase 4): Sphinx always
  loads its own bundle.
- **Account backend.** Everything that needed a Hydra account is hidden behind
  feature flags (PRD §4.B); the flags default to off.
- **Updater.** `electron-updater` pointing at `hydralauncher/hydra` is replaced by
  `tauri-plugin-updater` pointing at this repository (Fase 5,
  `docs/release.md`).

## Syncing from upstream

Upstream is a live project and may fix things Sphinx has not. The policy:

1. **Cherry-pick, do not merge.** `git fetch upstream` then pick individual
   commits, so a merge does not undo a phase's work.
2. **Never take branding or endpoints.** Skip those hunks; they are the whole
   point of the fork.
3. **Re-run the checks that own the area.** A cherry-pick that touches `src/main`
   needs `yarn gen:ipc-allowlist` (the sidecar allowlist is generated from that
   code) and the sidecar tests. A cherry-pick that touches the renderer needs the
   Vite build.
4. **Record it.** Every cherry-pick gets a line in `docs/MIGRATION_LOG.md` with
   the upstream commit hash and why it was taken.

## What we owe upstream

Bug fixes in the parts that were not forked away (the torrent engine, the
cloud-save pipeline, anything in `native/`) are worth sending upstream. Nothing
in this repository requires that, but it is the reason to keep the fork's diff
small enough to see.

## Trademark

The name "Sphinx" has not been cleared. `docs/MIGRATION_LOG.md` (Fase 2) records
this as an open item; it should be checked before a public release.
