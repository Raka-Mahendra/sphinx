# Windows-environmental test failures (Fase 1)

This document records the tests that fail on this Windows development machine, and proves
that they already fail on the untouched Hydra baseline. They are **not** regressions
introduced by the Sphinx migration.

## Summary

Full `src` test suite on this machine (Fase 1 branch `sphinx/tauri-migration`), excluding
`src/main/services/epic/` (Linux-only):

| Metric    | Value |
| --------- | ----- |
| Tests     | 1753  |
| Pass      | 1710  |
| Fail      | 22    |
| Skipped   | 21    |
| Cancelled | 0     |

Of the 22 failures:

- **21 are deterministic Windows-environment failures** and are byte-for-byte the same
  failures at the baseline commit (see proof below).
- **1 is a load-dependent flake** (`umu-launch-monitor.test.ts`, see below) that passes in
  isolation and is unrelated to the migration.

CI does not hit these: `.github/workflows/lint.yml` runs the suite on `ubuntu-latest`
(the only runner in the repo).

## Baseline proof

The failures were reproduced in a clean worktree checked out at the baseline commit,
independent of all Fase 1 changes.

- Baseline tag: `baseline-hydra`
- Commit: `be492f5e3fc4a37c55d7df2b07faf5f9565c84dd`
- Worktree: `C:\Users\Raka Mahendra\Dokumen\Projects\sphinx-baseline-hydra` (detached HEAD)
- `node_modules` junctioned to the working checkout so both runs use identical dependencies.

Command:

```bash
git worktree add <path> baseline-hydra
node --import ./scripts/register-ts-node.mjs --test --test-timeout=90000 \
  <the 16 affected test files>
```

Result at baseline (`be492f5`):

| Metric    | Value |
| --------- | ----- |
| Tests     | 130   |
| Pass      | 107   |
| Fail      | 21    |
| Skipped   | 2     |
| Cancelled | 0     |

The 21 baseline failures are **the same 21 locations** as the current run (identical file,
line and column). The only difference between the baseline set and the current set is
`umu-launch-monitor.test.ts:120:5`, which is the flake described below.

Raw evidence:

- `docs/evidence/baseline-hydra-failing-tests.txt` — baseline run summary + `failing tests:` section.
- `docs/evidence/fase1-full-suite-failing-tests.txt` — current full-suite summary + `failing tests:` section.

## The 21 failures, grouped by cause

All paths are relative to `src/main/services/`. Line:column refers to the test declaration.

### 1. Windows symlink privilege (`EPERM`) — 7 tests

Creating symlinks on Windows requires Developer Mode or elevation. The test fixtures call
`fs.symlink` and get `EPERM: operation not permitted`. On Linux CI these pass.

| Test file:line                                             | Test name                                                                     |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `cloud-save/emulator-destination-store.test.ts:47:5`       | requires an existing real directory and rejects symlinks                      |
| `cloud-save/emulator-manual-file-eligibility.test.ts:36:5` | allows an explicitly selected N64 Transfer Pak .sav with an arbitrary GB name |
| `cloud-save/retroarch-safe-move.test.ts:317:9`             | (symlink fixture)                                                             |
| `cloud-save/retroarch-safe-move.test.ts:317:9`             | (symlink fixture, second case)                                                |
| `cloud-save/rpcs3-config-root.test.ts:49:5`                | (symlink fixture)                                                             |
| `cloud-save/rpcs3-save-scanner.test.ts:201:5`              | (symlink fixture)                                                             |
| `cloud-save/rpcs3-savestate-restore.test.ts:28:5`          | (symlink fixture)                                                             |

### 2. POSIX vs Windows path separators / casing — 10 tests

The code under test produces host-native Windows paths (`C:\home\user`, `\mnt\steam\...`,
`nested\Game.NES`) while the tests expect POSIX-style paths, or Windows canonicalises the
user profile differently (`RAKAMA~1` vs `Raka Mahendra`, and `fs.realpath` casing).

| Test file:line                                      | Test name                                                        | Actual vs expected                                      |
| --------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------- |
| `cloud-save/custom-path.test.ts:235:5`              | canonicalizes an existing selected directory                     | `C:/Users/Raka Mahendra/...` vs `C:/Users/RAKAMA~1/...` |
| `cloud-save/retroarch-save-config.test.ts:15:5`     | resolves content and sorted save directories                     | `C:\home\user\saves\mGBA` vs `\home\user\saves\mGBA`    |
| `cloud-save/retroarch-save-config.test.ts:36:5`     | (path resolution)                                                | separator difference                                    |
| `cloud-save/retroarch-save-config.test.ts:140:5`    | (path resolution)                                                | separator difference                                    |
| `retroarch/retroarch-config-paths.test.ts:6:5`      | finds the macOS config subfolder for standalone and Steam builds | `darwin` candidate built with Windows separators        |
| `retroarch/rom-archive.test.ts:98:5`                | reads a real zip archive without extracting files                | `nested\Game [USA] é.NES` vs `nested/Game [USA] é.NES`  |
| `retroarch/rom-archive.test.ts:98:5`                | reads a real 7z archive without extracting files                 | same separator difference                               |
| `steam-integration/steam-installation.test.ts:64:1` | derives the Steam Proton prefix from the app installation        | `\mnt\steam\...\pfx` vs `/mnt/steam/.../pfx`            |
| `wine.test.ts:46:5`                                 | resolves the active profile from user.reg                        | `C:\Users\RAKAMA~1\...` vs `C:\Users\Raka Mahendra\...` |

(The two `rom-archive.test.ts:98:5` entries are two distinct tests declared at the same
line; the counter reports both.)

### 3. YAML escape sequence — 1 test

| Test file:line                              | Test name           | Cause                                                                                                                                                                         |
| ------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cloud-save/rpcs3-save-layout.test.ts:28:5` | (RPCS3 save layout) | Test builds a YAML string containing a Windows path; `\p` (`\portable`) is an invalid YAML escape → `YAMLParseError: Invalid escape sequence \p`. On Linux the path uses `/`. |

### 4. Custom-path validation (`local absolute` / symlink ancestor) — 3 tests

On Windows the validation rejects the fixture because the path shape or a symlinked
ancestor does not satisfy the "local absolute path" rule the POSIX fixtures assume.

| Test file:line                                           | Test name                                                               | Error                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------- |
| `cloud-save/custom-path-approval-selection.test.ts:8:1`  | binds a remote file to an existing file with a different name           | `cloud_save_custom_path_must_be_local_absolute` |
| `cloud-save/custom-path-approval-selection.test.ts:24:1` | rejects choosing a file for a directory snapshot                        | `cloud_save_custom_path_must_be_local_absolute` |
| `cloud-save/custom-path.test.ts:254:5`                   | keeps an approved missing destination valid when its parent is writable | `cloud_save_custom_path_symlink_ancestor`       |

### 5. Notification icon file privilege — 1 test

| Test file:line                                 | Test name                      | Error                                                                            |
| ---------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------- |
| `notifications/notification-icon.test.ts:22:1` | (notification icon generation) | `EPERM, Permission denied` writing under `%TEMP%\hydra-notification-icon-test-*` |

## The flake: `umu-launch-monitor.test.ts:120:5`

- Test: `rejects early exits with the umu failure detail`
- In the full-suite run it fails with `AssertionError: Missing expected rejection`.
- Run alone it passes: `node --import ./scripts/register-ts-node.mjs --test
--test-timeout=90000 src/main/services/umu-launch-monitor.test.ts` → 6/6 pass.
- It also passed inside the baseline worktree batch, confirming it is timing/load
  dependent rather than a code regression.

## How to reproduce the deterministic set

Run the 16 affected files (on a machine without Developer Mode / symlink privilege):

```bash
node --import ./scripts/register-ts-node.mjs --test --test-timeout=90000 \
  src/main/services/cloud-save/custom-path-approval-selection.test.ts \
  src/main/services/cloud-save/custom-path.test.ts \
  src/main/services/cloud-save/emulator-destination-store.test.ts \
  src/main/services/cloud-save/emulator-manual-file-eligibility.test.ts \
  src/main/services/cloud-save/retroarch-safe-move.test.ts \
  src/main/services/cloud-save/retroarch-save-config.test.ts \
  src/main/services/cloud-save/rpcs3-config-root.test.ts \
  src/main/services/cloud-save/rpcs3-save-layout.test.ts \
  src/main/services/cloud-save/rpcs3-save-scanner.test.ts \
  src/main/services/cloud-save/rpcs3-savestate-restore.test.ts \
  src/main/services/notifications/notification-icon.test.ts \
  src/main/services/retroarch/retroarch-config-paths.test.ts \
  src/main/services/retroarch/rom-archive.test.ts \
  src/main/services/steam-integration/steam-installation.test.ts \
  src/main/services/umu-launch-monitor.test.ts \
  src/main/services/wine.test.ts
```

Enabling Windows Developer Mode (or running elevated) removes the `EPERM` group; the
separator/casing group is a genuine Windows-vs-Linux expectation mismatch in the tests and
is out of scope for the migration.
